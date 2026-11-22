import { withSamplingClaim, type SamplingClaim } from "@/lib/monitoring/sampling-claim";
/**
 * Daily server uptime rollup (status-page heatmap source).
 *
 * health.sample already writes MetricSnapshot rows with isOnline.
 * This module aggregates those samples into ServerUptimeSnapshot for
 * /status 90-day heatmaps. Without this writer the UI always looks empty.
 * `onlineMinutes + offlineMinutes` is the covered time of the day; the
 * remainder had no sample and is unknown.
 */
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";
import { dayCoverageMinutes, sampleCoverageSql } from "./coverage";
import { appTimeZoneDateKey, shiftAppTimeZoneDay, startOfDayInAppTimeZone } from "@/lib/datetime/time-zone";

export { SAMPLE_SPAN_CAP_INTERVALS } from "./coverage";

const logger = createLogger("uptime-rollup");

type DayRow = {
  serverId: string;
  online: bigint | number;
  offline: bigint | number;
  online_s: number | null;
  offline_s: number | null;
};

function count(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value;
}

/**
 * Roll up MetricSnapshot samples for one application-time-zone calendar day
 * (the day the status page labels) into ServerUptimeSnapshot rows, one per
 * enabled server that has samples. `date` is the instant that day starts.
 *
 * Minutes come from the real sample times, not from "count × interval": each
 * sample covers the time until the next sample of that server (or the end of
 * the day / now), capped at twice the interval recorded on the row. Rows
 * written before the interval was recorded used the then-fixed
 * HEALTH_SAMPLE_INTERVAL_MINUTES cadence. So a changed sampling interval never
 * re-scales older days, and a stopped sampler leaves uncovered (unknown)
 * time instead of being stretched into availability. The percentage is the
 * online share of the covered time.
 */
export async function rollupServerUptimeForDay(
  day: Date = new Date(),
  claim?: SamplingClaim,
): Promise<{ upserted: number }> {
  const dayStart = startOfDayInAppTimeZone(day);
  const dayEnd = shiftAppTimeZoneDay(dayStart, 1);
  const now = new Date();
  const coverEnd = now < dayEnd ? now : dayEnd;
  const dayMinutes = dayCoverageMinutes(dayStart, now);
  const rows = await prisma.$queryRaw<DayRow[]>`
    SELECT "serverId",
      count(*) FILTER (WHERE in_window AND "isOnline") AS online,
      count(*) FILTER (WHERE in_window AND NOT "isOnline") AS offline,
      sum(span) FILTER (WHERE "isOnline") AS online_s,
      sum(span) FILTER (WHERE NOT "isOnline") AS offline_s
    FROM (${sampleCoverageSql(dayStart, coverEnd)}) samples
    WHERE in_window OR span > 0
    GROUP BY "serverId"`;

  let upserted = 0;
  let sampleTotal = 0;

  for (const row of rows) {
    claim?.signal.throwIfAborted();
    const online = count(row.online);
    const offline = count(row.offline);
    const checkCount = online + offline;
    sampleTotal += checkCount;

    const onlineSeconds = Math.max(0, row.online_s ?? 0);
    const offlineSeconds = Math.max(0, row.offline_s ?? 0);
    const onlineMinutes = Math.min(dayMinutes, Math.round(onlineSeconds / 60));
    const offlineMinutes = Math.min(dayMinutes - onlineMinutes, Math.round(offlineSeconds / 60));
    const coveredSeconds = onlineSeconds + offlineSeconds;
    // Same-instant samples cover no time; fall back to the sample share.
    const uptimePercent = coveredSeconds > 0
      ? Math.round((onlineSeconds / coveredSeconds) * 10000) / 100
      : Math.round((online / checkCount) * 10000) / 100;

    // A day's samples only grow while its raw rows are kept. Fewer than the
    // stored summary counted means retention pruned part of the day: the
    // stored figure is the complete one (a short retention rewrote a finished
    // 50% day as 100% from its surviving half).
    const stored = await prisma.serverUptimeSnapshot.findUnique({
      where: { serverId_date: { serverId: row.serverId, date: dayStart } },
      select: { checkCount: true },
    });
    if (stored && stored.checkCount > checkCount) continue;

    await withSamplingClaim(claim, (tx) => tx.serverUptimeSnapshot.upsert({
      where: {
        serverId_date: {
          serverId: row.serverId,
          date: dayStart,
        },
      },
      create: {
        serverId: row.serverId,
        date: dayStart,
        uptimePercent,
        onlineMinutes,
        offlineMinutes,
        checkCount,
      },
      update: {
        uptimePercent,
        onlineMinutes,
        offlineMinutes,
        checkCount,
      },
    }));
    upserted += 1;
  }

  if (upserted > 0) {
    logger.info("uptime rollup completed", {
      day: appTimeZoneDateKey(dayStart),
      upserted,
      samples: sampleTotal,
    });
  }
  return { upserted };
}

/** Roll up today + yesterday (covers late-night boundary samples). */
export async function rollupRecentServerUptime(claim?: SamplingClaim): Promise<{
  upserted: number;
}> {
  const now = new Date();
  const today = await rollupServerUptimeForDay(now, claim);
  const y = await rollupServerUptimeForDay(shiftAppTimeZoneDay(now, -1), claim);
  return { upserted: today.upserted + y.upserted };
}
