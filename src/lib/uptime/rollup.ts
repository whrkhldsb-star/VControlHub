/**
 * Daily server uptime rollup (status-page heatmap source).
 *
 * health.sample already writes MetricSnapshot rows with isOnline.
 * This module aggregates those samples into ServerUptimeSnapshot for
 * /status 90-day heatmaps. Without this writer the UI always looks empty.
 */
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";

const logger = createLogger("uptime-rollup");

function utcDayStart(date = new Date()): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function utcDayEnd(dayStart: Date): Date {
  return new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Roll up MetricSnapshot samples for a UTC calendar day into
 * ServerUptimeSnapshot rows (one per enabled server that has samples).
 */
export async function rollupServerUptimeForDay(day: Date = new Date()): Promise<{ upserted: number }> {
  const dayStart = utcDayStart(day);
  const dayEnd = utcDayEnd(dayStart);

  const servers = await prisma.server.findMany({
    where: { enabled: true },
    select: { id: true },
    take: 500,
  });
  if (servers.length === 0) return { upserted: 0 };

  const samples = await prisma.metricSnapshot.findMany({
    where: {
      serverId: { in: servers.map((s) => s.id) },
      createdAt: { gte: dayStart, lt: dayEnd },
    },
    select: { serverId: true, isOnline: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 50_000,
  });

  const byServer = new Map<string, { online: number; offline: number }>();
  for (const sample of samples) {
    const bucket = byServer.get(sample.serverId) ?? { online: 0, offline: 0 };
    if (sample.isOnline) bucket.online += 1;
    else bucket.offline += 1;
    byServer.set(sample.serverId, bucket);
  }

  // health.sample interval is ~5 minutes → treat each sample as 5 minutes.
  const MINUTES_PER_SAMPLE = 5;
  let upserted = 0;

  for (const server of servers) {
    const counts = byServer.get(server.id);
    if (!counts) continue;
    const checkCount = counts.online + counts.offline;
    if (checkCount <= 0) continue;

    const onlineMinutes = Math.min(1440, counts.online * MINUTES_PER_SAMPLE);
    const offlineMinutes = Math.min(1440, counts.offline * MINUTES_PER_SAMPLE);
    const uptimePercent = Math.round((counts.online / checkCount) * 10000) / 100;

    await prisma.serverUptimeSnapshot.upsert({
      where: {
        serverId_date: {
          serverId: server.id,
          date: dayStart,
        },
      },
      create: {
        serverId: server.id,
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
      day: dayStart.toISOString().slice(0, 10),
      upserted,
      samples: samples.length,
    });
  }
  return { upserted };
}

/** Roll up today + yesterday (covers late-night boundary samples). */
export async function rollupRecentServerUptime(): Promise<{ upserted: number }> {
  const today = await rollupServerUptimeForDay(new Date());
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const y = await rollupServerUptimeForDay(yesterday);
  return { upserted: today.upserted + y.upserted };
}
