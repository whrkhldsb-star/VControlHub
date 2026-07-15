import { readFileSync } from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { teamWhere } from "@/lib/auth/team-scope";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import {
  calculateTrafficRate,
  formatBytes,
  formatBytesPerSecond,
  parseNetworkDeviceStats,
  selectPrimaryInterface,
  type NetworkDeviceStats,
} from "@/lib/monitoring/traffic";
import { sampleRemoteServersTraffic } from "@/lib/monitoring/remote-traffic";

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

function readProcNetDev() {
  try {
    return readFileSync("/proc/net/dev", "utf-8");
  } catch {
    return "";
  }
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
      trafficSource: "current server",
      trafficSourceLabel: "current server NIC",
      trafficSourceDetail: "Using current server NIC statistics, download and upload will count as local traffic.",
      remoteServerId: null as string | null,
    };
  }

  if (node.server) {
    return {
      trafficSource: "bound server",
      trafficSourceLabel: `bound server: ${node.server.name}`,
      trafficSourceDetail: `${node.server.name} (${node.server.host}:${node.server.port}) actual traffic is visible under "VPS node traffic".`,
      remoteServerId: node.server.id,
    };
  }

  const host = node.host?.trim();
  return {
    trafficSource: "Remote SFTP host",
    trafficSourceLabel: host ? `Remote SFTP: ${host}` : "Remote SFTP: host Not configured",
    trafficSourceDetail: host
      ? `${host}:${node.port ?? 22} traffic occurs on the target server; for sampling, please bind the SFTP node to a VPS node.`
      : "The SFTP node does not have a host configured, cannot locate remote traffic source.",
    remoteServerId: null,
  };
}

export async function GET(req: NextRequest) {
  return withApiRoute(
    req,
    { permission: "server:read", errorMessage: "Failed to fetch traffic summary" },
    async (ctx) => {
      const session = ctx.session;
      if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const q = parseSearchParams(req, trafficSummaryQuerySchema);
      const selectedIface = q.iface ?? "";
      const includeRemote =
        (q.include ?? "").split(",").map((token) => token.trim()).includes("remote");

      const interfaces = parseNetworkDeviceStats(readProcNetDev());
      const primary = selectedIface
        ? (interfaces.find((item) => item.iface === selectedIface) ?? selectPrimaryInterface(interfaces))
        : selectPrimaryInterface(interfaces);

      const teamFilter = teamWhere(session);
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

      const servers = await prisma.server.findMany({
        where: { enabled: true, ...teamFilter },
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
      });

      const remoteServers = includeRemote ? await sampleRemoteServersTraffic(servers) : null;

      if (primary) {
        void persistLocalInterfaceSample(primary.iface, summarizeInterface(`local:${primary.iface}`, primary));
      }

      return NextResponse.json({
        timestamp: new Date().toISOString(),
        currentServer: {
          type: "LOCAL_SERVER",
          id: "local",
          name: "current server",
          primaryInterface: primary ? summarizeInterface(`local:${primary.iface}`, primary) : null,
          interfaces: interfaces.map((item) => summarizeInterface(`local:${item.iface}`, item)),
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
