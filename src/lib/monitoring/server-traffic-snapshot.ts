import { prisma } from "@/lib/db";
import type { ServerMetrics } from "@/lib/server/monitor";
import { calculateTrafficRate, evictStaleTrafficSamples, type TrafficCounterSample } from "./traffic";

const previousSamples = new Map<string, TrafficCounterSample>();

export async function persistServerTrafficFromMetrics(serverId: string, metrics: ServerMetrics) {
  const primary = metrics.network[0];
  if (!primary) return false;
  const key = `${serverId}:${primary.iface}`;
  const current = { rxBytes: primary.rxBytes, txBytes: primary.txBytes, sampledAt: metrics.timestamp };
  // Evict before the lookup so this sample's own stale baseline is dropped too:
  // a rate computed against it would be a long-run average, not a current rate.
  const sampleTime = Date.parse(current.sampledAt);
  evictStaleTrafficSamples(previousSamples, Number.isFinite(sampleTime) ? sampleTime : Date.now());
  const rate = calculateTrafficRate(previousSamples.get(key) ?? null, current);
  previousSamples.set(key, current);
  await prisma.trafficSnapshot.create({
    data: {
      source: "server",
      serverId,
      iface: primary.iface,
      rxBytes: BigInt(Math.max(0, Math.trunc(primary.rxBytes))),
      txBytes: BigInt(Math.max(0, Math.trunc(primary.txBytes))),
      rxRateBps: rate.rxBytesPerSecond,
      txRateBps: rate.txBytesPerSecond,
    },
  });
  return true;
}
