import { Prisma } from "@prisma/client";
import { shiftAppTimeZoneDay } from "@/lib/datetime/time-zone";
import { HEALTH_SAMPLE_INTERVAL_MINUTES } from "@/lib/health/service-types";

/** How long a sample can speak for a host that has stopped reporting. */
export const SAMPLE_SPAN_CAP_INTERVALS = 2;

export function dayCoverageMinutes(dayStart: Date, now: Date): number {
  const end = Math.min(shiftAppTimeZoneDay(dayStart, 1).getTime(), now.getTime());
  return Math.max(1, Math.floor((end - dayStart.getTime()) / 60_000));
}

/** The intersection of each sample's effective interval with [from, to). */
export function sampleCoverageSql(from: Date, to: Date, serverId?: string) {
  const hosts = serverId === undefined ? Prisma.sql`s.enabled` : Prisma.sql`s.id = ${serverId}`;
  return Prisma.sql`
    WITH samples AS (
      SELECT s.id AS "serverId", m.* FROM servers s
      CROSS JOIN LATERAL (
        (SELECT id, "createdAt", "isOnline", "intervalSeconds" FROM metric_snapshots
         WHERE "serverId" = s.id AND "createdAt" < ${from}::timestamp
         ORDER BY "createdAt" DESC, id DESC LIMIT 1)
        UNION ALL
        SELECT id, "createdAt", "isOnline", "intervalSeconds" FROM metric_snapshots
        WHERE "serverId" = s.id AND "createdAt" >= ${from}::timestamp AND "createdAt" < ${to}::timestamp
      ) m WHERE ${hosts}
    ), intervals AS (
      SELECT *, COALESCE("intervalSeconds", ${HEALTH_SAMPLE_INTERVAL_MINUTES * 60}) AS iv,
        lead("createdAt", 1, ${to}::timestamp) OVER (PARTITION BY "serverId" ORDER BY "createdAt", id) AS next_at
      FROM samples
    )
    SELECT "serverId", "isOnline", iv, "createdAt" >= ${from}::timestamp AS in_window,
      GREATEST(0, EXTRACT(EPOCH FROM (
        LEAST(next_at, "createdAt" + make_interval(secs => iv::float8 * ${SAMPLE_SPAN_CAP_INTERVALS})) - GREATEST("createdAt", ${from}::timestamp)
      )))::float8 AS span
    FROM intervals`;
}
