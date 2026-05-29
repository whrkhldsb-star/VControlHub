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

export async function GET(req: NextRequest) {
  return withApiRoute(
    req,
    { permission: "server:read", errorMessage: "获取流量摘要失败" },
    async () => {
      const selectedIface = req.nextUrl.searchParams.get("iface")?.trim() || "";

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
        },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      });

      const servers = await prisma.server.findMany({
        where: { enabled: true },
        select: { id: true, name: true, host: true, port: true },
        orderBy: { name: "asc" },
      });

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
        storageNodes: storageNodes.map((node) => ({
          id: node.id,
          name: node.name,
          driver: node.driver,
          serverId: node.serverId,
          host: node.host,
          port: node.port,
          healthStatus: node.healthStatus,
          trafficSource:
            node.driver === "LOCAL"
              ? "当前服务器"
              : node.serverId
                ? "绑定服务器"
                : "远程 SFTP 主机",
        })),
        servers,
      });
    },
  );
}
