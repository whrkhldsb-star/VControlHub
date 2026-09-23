import { apiCopy } from "@/lib/i18n/api-copy";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { serverTeamWhere, teamWhere } from "@/lib/auth/team-scope";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import {
  calculateTrafficRate,
  formatBytes,
  formatBytesPerSecond,
  selectPrimaryInterface,
  type NetworkDeviceStats,
} from "@/lib/monitoring/traffic";
import { readLocalNetworkDeviceStats } from "@/lib/monitoring/local-network";
import { sampleRemoteServersTraffic } from "@/lib/monitoring/remote-traffic";
import { t } from "@/lib/i18n/translations";

/**
 * TR-037 R5+: the route used to inline `req.nextUrl.searchParams.get(...)`
 * twice and call `.split(",")` ad hoc. Move both reads behind a
 * `parseSearchParams(...)` zod call so:
 *   - `?iface=` empty string is rejected (we don't want to call
 *     `find(item => item.iface === "")` against the parsed list)
 *   - `?include=remote,junk,remote` doesn't crash on a `,` with no value
 *   - oversized inputs are bounded
 *
 * `include=remote` is the only meaningful value; unknown tokens are still
 * silently dropped inside the handler (no contract break for the SPA).
 */
const trafficSummaryQuerySchema = z.object({
  iface: z.string().trim().min(1).max(64).optional(),
  include: z.string().trim().max(64).optional(),
});

export const dynamic = "force-dynamic";

type CachedTrafficSample = {
  rxBytes: number;
  txBytes: number;
  sampledAt: string;
};

const previousSamples = new Map<string, CachedTrafficSample>();

/**
 * The durable `traffic.sample` worker owns traffic_snapshots and writes one row
 * per primary interface every 5 minutes. This route wrote a row on *every*
 * request as well, and the /traffic page turns one refresh into two requests
 * here (`fetchSummary` plus `fetchRemote`), so a single open tab at the default
 * 30s cadence produced ~5 700 rows a day against the worker's 288 — and each
 * extra row carried a rate diffed against whatever poll happened milliseconds
 * earlier through the shared `previousSamples` slot.
 *
 * The write stays as a fallback for deployments running with workers disabled,
 * but it is held to the worker's own cadence and skips samples whose interval is
 * too short to mean anything.
 */
const REQUEST_PERSIST_MIN_INTERVAL_MS = 5 * 60_000;
const MIN_PERSIST_INTERVAL_SECONDS = 1;
const lastPersistedAt = new Map<string, number>();

function shouldPersistLocalSample(iface: string, intervalSeconds: number) {
  if (intervalSeconds < MIN_PERSIST_INTERVAL_SECONDS) return false;
  const now = Date.now();
  if (now - (lastPersistedAt.get(iface) ?? 0) < REQUEST_PERSIST_MIN_INTERVAL_MS) {
    return false;
  }
  // Claim the slot synchronously: two concurrent polls must not both pass.
  lastPersistedAt.set(iface, now);
  return true;
}

function summarizeInterface(targetKey: string, sample: NetworkDeviceStats) {
  const current = {
    rxBytes: sample.rxBytes,
    txBytes: sample.txBytes,
    sampledAt: new Date().toISOString(),
  };
  const previous = previousSamples.get(targetKey) ?? null;
  previousSamples.set(targetKey, current);
  const rate = calculateTrafficRate(previous, current);
  return {
    iface: sample.iface,
    rxBytes: sample.rxBytes,
    txBytes: sample.txBytes,
    rxLabel: formatBytes(sample.rxBytes),
    txLabel: formatBytes(sample.txBytes),
    rxRateBytesPerSecond: rate.rxBytesPerSecond,
    txRateBytesPerSecond: rate.txBytesPerSecond,
    rxRateLabel: formatBytesPerSecond(rate.rxBytesPerSecond),
    txRateLabel: formatBytesPerSecond(rate.txBytesPerSecond),
    intervalSeconds: rate.intervalSeconds,
  };
}

async function persistTrafficSample(input: {
  source: string;
  serverId: string | null;
  iface: string;
  rxBytes: number;
  txBytes: number;
  rxRateBps: number;
  txRateBps: number;
}) {
  try {
    await prisma.trafficSnapshot.create({
      data: {
        source: input.source,
        serverId: input.serverId,
        iface: input.iface,
        rxBytes: BigInt(Math.max(0, Math.trunc(input.rxBytes))),
        txBytes: BigInt(Math.max(0, Math.trunc(input.txBytes))),
        rxRateBps: Math.max(0, input.rxRateBps),
        txRateBps: Math.max(0, input.txRateBps),
      },
    });
  } catch {
    // Best-effort history only; live response must not fail because the DB write failed.
  }
}

async function persistLocalInterfaceSample(iface: string, sample: ReturnType<typeof summarizeInterface>) {
  await persistTrafficSample({
    source: "local",
    serverId: null,
    iface,
    rxBytes: sample.rxBytes,
    txBytes: sample.txBytes,
    rxRateBps: sample.rxRateBytesPerSecond,
    txRateBps: sample.txRateBytesPerSecond,
  });
}

function describeStorageTrafficSource(node: {
  driver: string;
  serverId: string | null;
  host: string | null;
  port: number | null;
  server?: { id: string; name: string; host: string; port: number } | null;
}) {
  if (node.driver === "LOCAL") {
    return {
      trafficSource: t("backend.traffic.source.local"),
      trafficSourceLabel: t("backend.traffic.source.localLabel"),
      trafficSourceDetail: t("backend.traffic.source.localDetail"),
      remoteServerId: null as string | null,
    };
  }

  if (node.server) {
    return {
      trafficSource: t("backend.traffic.source.bound"),
      trafficSourceLabel: t("backend.traffic.source.boundLabel", { name: node.server.name }),
      trafficSourceDetail: t("backend.traffic.source.boundDetail", { name: node.server.name, host: node.server.host, port: node.server.port }),
      remoteServerId: node.server.id,
    };
  }

  const host = node.host?.trim();
  return {
    trafficSource: t("backend.traffic.source.remoteSftp"),
    trafficSourceLabel: host
      ? t("backend.traffic.source.remoteSftpLabel", { host })
      : t("backend.traffic.source.remoteSftpUnconfigured"),
    trafficSourceDetail: host
      ? t("backend.traffic.source.remoteSftpDetail", { host, port: node.port ?? 22 })
      : t("backend.traffic.source.remoteSftpNoHost"),
    remoteServerId: null,
  };
}

export async function GET(req: NextRequest) {
  return withApiRoute(
    req,
    { permission: "server:read", errorMessage: apiCopy("apiCopy.failed.to.fetch.traffic.summary.0ac2f2fb") },
    async (ctx) => {
      const session = ctx.session;
      const q = parseSearchParams(req, trafficSummaryQuerySchema);
      const selectedIface = q.iface ?? "";
      const includeRemote =
        (q.include ?? "").split(",").map((token) => token.trim()).includes("remote");

      const interfaces = readLocalNetworkDeviceStats();
      const primary = selectedIface
        ? (interfaces.find((item) => item.iface === selectedIface) ?? selectPrimaryInterface(interfaces))
        : selectPrimaryInterface(interfaces);

      const teamFilter = teamWhere(session);
      // Servers are security roots: this route hands back their host/port and,
      // with `include=remote`, loads their SSH credentials and dials out. A null
      // teamId is quarantined legacy data, never a shared VPS, so the strict
      // filter applies here even though storage nodes use the loose one.
      const serverFilter = serverTeamWhere(session);
      const storageNodes = await prisma.storageNode.findMany({
        where: teamFilter,
        select: {
          id: true,
          name: true,
          driver: true,
          serverId: true,
          host: true,
          port: true,
          healthStatus: true,
          server: {
            select: { id: true, name: true, host: true, port: true },
          },
        },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        take: 100,
      });

      // Only materialize SSH secrets when remote sampling is requested.
      // List/metadata polls return id/name/host/port only and must not load credentials.
      const servers = includeRemote
        ? await prisma.server.findMany({
            where: { enabled: true, ...serverFilter },
            select: {
              id: true,
              name: true,
              host: true,
              port: true,
              username: true,
              password: true,
              sshKeyId: true,
              sshKey: { select: { privateKey: true } },
            },
            orderBy: { name: "asc" },
            take: 200,
          })
        : await prisma.server.findMany({
            where: { enabled: true, ...serverFilter },
            select: {
              id: true,
              name: true,
              host: true,
              port: true,
            },
            orderBy: { name: "asc" },
            take: 200,
          });

      const remoteServers = includeRemote
        ? await sampleRemoteServersTraffic(
            servers as Array<{
              id: string;
              name: string;
              host: string;
              port: number;
              username: string;
              password: string | null;
              sshKeyId: string | null;
              sshKey?: { privateKey: string | null } | null;
            }>,
          )
        : null;

      // Summarize each local interface once per request. Calling summarize twice
      // for the primary iface advanced the previousSamples cache mid-request and
      // made primary rates nearly always 0 after the first poll.
      const summarizedInterfaces = interfaces.map((item) =>
        summarizeInterface(`local:${item.iface}`, item),
      );
      const primarySummary =
        primary
          ? summarizedInterfaces.find((item) => item.iface === primary.iface) ?? null
          : null;
      if (
        primarySummary &&
        shouldPersistLocalSample(primarySummary.iface, primarySummary.intervalSeconds)
      ) {
        void persistLocalInterfaceSample(primarySummary.iface, primarySummary);
      }

      return NextResponse.json({
        timestamp: new Date().toISOString(),
        currentServer: {
          type: "LOCAL_SERVER",
          id: "local",
          name: t("backend.traffic.currentServerName"),
          primaryInterface: primarySummary,
          interfaces: summarizedInterfaces,
        },
        storageNodes: storageNodes.map((node) => {
          const source = describeStorageTrafficSource(node);
          return {
            id: node.id,
            name: node.name,
            driver: node.driver,
            serverId: node.serverId,
            server: node.server,
            host: node.host,
            port: node.port,
            healthStatus: node.healthStatus,
            ...source,
          };
        }),
        remoteServers,
        servers: servers.map((s) => ({
          id: s.id,
          name: s.name,
          host: s.host,
          port: s.port,
        })),
      });
    },
  );
}
