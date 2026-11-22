import { sampledEndpoint, sampledServerScope, type HealthEndpoint } from "@/lib/health/sample-binding";
import { lockForTransaction } from "@/lib/concurrency/advisory-lock";
import { prisma } from "@/lib/db";
import { checkSamplingClaim, sampleId, type SamplingClaim } from "@/lib/monitoring/sampling-claim";
import type { ServerMetrics } from "@/lib/server/monitor";
import { calculateTrafficRate, evictStaleTrafficSamples, selectPrimaryInterface, type TrafficCounterSample } from "./traffic";

const previousSamples = new Map<string, TrafficCounterSample>();

export async function persistServerTrafficFromMetrics(serverId: string, metrics: ServerMetrics, claim?: SamplingClaim, endpoint?: HealthEndpoint) {
  // The first listed interface is often docker0/veth; prefer a physical one
  // (the status board derives rates from these rows).
  const primary = selectPrimaryInterface(metrics.network);
  if (!primary) return false;
  const key = JSON.stringify([serverId, primary.iface, endpoint]);
  const current = { rxBytes: primary.rxBytes, txBytes: primary.txBytes, sampledAt: metrics.timestamp };
  // Evict before the lookup so this sample's own stale baseline is dropped too:
  // a rate computed against it would be a long-run average, not a current rate.
  const sampleTime = Date.parse(current.sampledAt);
  if (!Number.isFinite(sampleTime)) return false;
  evictStaleTrafficSamples(previousSamples, sampleTime);
  const rate = calculateTrafficRate(previousSamples.get(key) ?? null, current);
  const sampledAt = new Date(sampleTime);
  const written = await prisma.$transaction(async (tx) => {
    await checkSamplingClaim(tx, claim);
    // Both the report timestamp and (when present) the sampling job identify
    // duplicates. Serialize this interface across workers before checking either.
    await lockForTransaction(tx, "traffic-sample", `${serverId}:${primary.iface}`);
    if (endpoint) {
      const current = await tx.$queryRaw<{ id: string }[]>`SELECT s.id FROM servers s
        WHERE TRUE ${sampledServerScope([{ serverId, [sampledEndpoint]: endpoint }])} FOR SHARE OF s`;
      if (!current.length) return false;
    }
    const sameReport = await tx.trafficSnapshot.findFirst({
      where: { source: "server", serverId, iface: primary.iface, sampledAt },
      select: { id: true },
    });
    if (sameReport) return false;
    const id = claim ? sampleId("traffic-job", claim.jobId, serverId, primary.iface)
      : sampleId("traffic", serverId, primary.iface, sampledAt.toISOString());
    const result = await tx.trafficSnapshot.createMany({
      data: {
        id, sampledAt, source: "server", serverId, iface: primary.iface,
        rxBytes: BigInt(Math.max(0, Math.trunc(primary.rxBytes))),
        txBytes: BigInt(Math.max(0, Math.trunc(primary.txBytes))),
        rxRateBps: rate.rxBytesPerSecond, txRateBps: rate.txBytesPerSecond,
      },
      skipDuplicates: true,
    });
    await checkSamplingClaim(tx, claim);
    return result.count === 1;
  });
  const previous = previousSamples.get(key);
  if (written && (!previous || sampleTime > Date.parse(previous.sampledAt))) previousSamples.set(key, current);
  return written;
}
