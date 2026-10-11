/**
 * Daily server uptime rollup (status-page heatmap source).
 *
 * health.sample already writes MetricSnapshot rows with isOnline.
 * This module aggregates those samples into ServerUptimeSnapshot for
 * /status 90-day heatmaps. Without this writer the UI always looks empty.
 */
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";
import { HEALTH_SAMPLE_INTERVAL_MINUTES } from "@/lib/health/service-types";
import { appTimeZoneDateKey, shiftAppTimeZoneDay, startOfDayInAppTimeZone } from "@/lib/datetime/time-zone";

const logger = createLogger("uptime-rollup");

/**
 * Roll up MetricSnapshot samples for one application-time-zone calendar day
 * (the day the status page labels) into ServerUptimeSnapshot rows, one per
 * enabled server that has samples. `date` is the instant that day starts.
 */
export async function rollupServerUptimeForDay(
  day: Date = new Date(),
): Promise<{ upserted: number }> {
  const dayStart = startOfDayInAppTimeZone(day);
  const dayEnd = shiftAppTimeZoneDay(dayStart, 1);

  const grouped = await prisma.metricSnapshot.groupBy({
    by: ["serverId", "isOnline"],
    where: {
      server: { enabled: true },
      createdAt: { gte: dayStart, lt: dayEnd },
    },
    _count: { _all: true },
  });

  const byServer = new Map<string, { online: number; offline: number }>();
  for (const group of grouped) {
    const bucket = byServer.get(group.serverId) ?? { online: 0, offline: 0 };
    if (group.isOnline) bucket.online = group._count._all;
    else bucket.offline = group._count._all;
    byServer.set(group.serverId, bucket);
  }

  // Each MetricSnapshot row covers one sampler tick; derive minutes-per-sample
  // from the shared cadence constant so this never drifts from the worker.
  const MINUTES_PER_SAMPLE = HEALTH_SAMPLE_INTERVAL_MINUTES;
  let upserted = 0;

  for (const [serverId, counts] of byServer) {
    const checkCount = counts.online + counts.offline;
    if (checkCount <= 0) continue;

    const onlineMinutes = Math.min(1440, counts.online * MINUTES_PER_SAMPLE);
    const offlineMinutes = Math.min(1440, counts.offline * MINUTES_PER_SAMPLE);
    const uptimePercent =
      Math.round((counts.online / checkCount) * 10000) / 100;

    await prisma.serverUptimeSnapshot.upsert({
      where: {
        serverId_date: {
          serverId,
          date: dayStart,
        },
      },
      create: {
        serverId,
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
    });
    upserted += 1;
  }

  if (upserted > 0) {
    logger.info("uptime rollup completed", {
      day: appTimeZoneDateKey(dayStart),
      upserted,
      samples: grouped.reduce((total, group) => total + group._count._all, 0),
    });
  }
  return { upserted };
}

/** Roll up today + yesterday (covers late-night boundary samples). */
export async function rollupRecentServerUptime(): Promise<{
  upserted: number;
}> {
  const now = new Date();
  const today = await rollupServerUptimeForDay(now);
  const y = await rollupServerUptimeForDay(shiftAppTimeZoneDay(now, -1));
  return { upserted: today.upserted + y.upserted };
}
