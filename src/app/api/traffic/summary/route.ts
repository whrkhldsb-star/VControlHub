import { readFileSync } from "node:fs";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import {
  calculateTrafficRate,
  formatBytes,
  formatBytesPerSecond,
  parseNetworkDeviceStats,
  selectPrimaryInterface,
  type NetworkDeviceStats,
} from "@/lib/monitoring/traffic";
import { sampleRemoteServersTraffic } from "@/lib/monitoring/remote-traffic";

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

function describeStorageTrafficSource(node: {
  driver: string;
  serverId: string | null;
  host: string | null;
  port: number | null;
  server?: { id: string; name: string; host: string; port: number } | null;
}) {
  if (node.driver === "LOCAL") {
    return {
      trafficSource: "当前服务器",
      trafficSourceLabel: "当前服务器网卡",
      trafficSourceDetail: "使用当前服务器网卡统计，下载和上传会计入本机流量。",
      remoteServerId: null as string | null,
    };
  }

  if (node.server) {
    return {
      trafficSource: "绑定服务器",
      trafficSourceLabel: `绑定服务器：${node.server.name}`,
      trafficSourceDetail: `${node.server.name}（${node.server.host}:${node.server.port}）的实时流量见下方 “VPS 节点流量”。`,
      remoteServerId: node.server.id,
    };
  }

  const host = node.host?.trim();
  return {
    trafficSource: "远程 SFTP 主机",
    trafficSourceLabel: host ? `远程 SFTP：${host}` : "远程 SFTP：未配置主机",
    trafficSourceDetail: host
      ? `${host}:${node.port ?? 22} 流量发生在目标服务器；如需采样请把该 SFTP 节点绑定到 VPS 节点。`
      : "该 SFTP 节点尚未配置主机，无法定位远端流量来源。",
    remoteServerId: null,
  };
}

export async function GET(req: NextRequest) {
  return withApiRoute(
    req,
    { permission: "server:read", errorMessage: "获取流量摘要失败" },
    async () => {
      const selectedIface = req.nextUrl.searchParams.get("iface")?.trim() || "";
      // include=remote opts in to the SSH sampling step. The default response
      // skips it so the page can render the local network card immediately
      // (~50 ms) while remote VPS samples (1-15 s) load asynchronously.
      const includeRemote =
        req.nextUrl.searchParams.get("include")?.split(",").includes("remote") ?? false;

      const interfaces = parseNetworkDeviceStats(readProcNetDev());
      const primary = selectedIface
        ? (interfaces.find((item) => item.iface === selectedIface) ??
          selectPrimaryInterface(interfaces))
        : selectPrimaryInterface(interfaces);

      const storageNodes = await prisma.storageNode.findMany({
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
        where: { enabled: true },
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

      return NextResponse.json({
        timestamp: new Date().toISOString(),
        currentServer: {
          type: "LOCAL_SERVER",
          id: "local",
          name: "当前服务器",
          primaryInterface: primary
            ? summarizeInterface(`local:${primary.iface}`, primary)
            : null,
          interfaces: interfaces.map((item) =>
            summarizeInterface(`local:${item.iface}`, item),
          ),
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
