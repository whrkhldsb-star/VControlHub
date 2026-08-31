import { prisma } from "@/lib/db";
import type { ServerMetrics } from "@/lib/server/monitor";
import { calculateTrafficRate, type TrafficCounterSample } from "./traffic";

const previousSamples = new Map<string, TrafficCounterSample>();

/**
 * Drop a cached counter that has not been refreshed within this window.
 *
 * The map is keyed by `serverId:iface` and was never pruned: a server removed
 * from the fleet (or a renamed interface) kept its entry for the lifetime of the
 * worker process. The worse half is the arithmetic — after a sampling gap the
 * stored baseline can be hours old, and `calculateTrafficRate` divides the
 * counter delta by that whole span, so a long-run average gets written into
 * `rxRateBps`/`txRateBps` as if it were current throughput, then feeds the
 * monthly rollup.
 *
 * Mirrors `PREVIOUS_SAMPLE_TTL_MS` in `./remote-traffic`, which holds the same
 * kind of cache for SSH-sampled counters. One hour is far longer than the
 * 5-minute sampling cadence, so a healthy server never loses its baseline.
 */
const PREVIOUS_SAMPLE_TTL_MS = 60 * 60 * 1000;

function evictStalePreviousSamples(now: number): void {
  for (const [key, sample] of previousSamples) {
    const sampledAt = Date.parse(sample.sampledAt);
    if (!Number.isFinite(sampledAt) || now - sampledAt > PREVIOUS_SAMPLE_TTL_MS) {
      previousSamples.delete(key);
    }
  }
}

export async function persistServerTrafficFromMetrics(serverId: string, metrics: ServerMetrics) {
  const primary = metrics.network[0];
  if (!primary) return false;
  const key = `${serverId}:${primary.iface}`;
  const current = { rxBytes: primary.rxBytes, txBytes: primary.txBytes, sampledAt: metrics.timestamp };
  // Evict before the lookup so this sample's own stale baseline is dropped too:
  // a rate computed against it would be a long-run average, not a current rate.
  const sampleTime = Date.parse(current.sampledAt);
  evictStalePreviousSamples(Number.isFinite(sampleTime) ? sampleTime : Date.now());
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
