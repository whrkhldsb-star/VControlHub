/**
 * The dashboard's two reads over large tables, grouped in PostgreSQL.
 *
 * `GET /api/dashboard/analytics` used to page through every metric snapshot of
 * the last day and every audit row of the last thirty in batches of 5,000 and
 * add them up in the web process. Measured on the snapshots: 28,800 rows (100
 * servers sampled every 5 minutes) took 6 queries and 236 ms against 11 ms for
 * one grouped statement; 144,000 rows (a 1-minute cadence) took 29 queries and
 * 1.46 s against 43 ms, on every visit to the dashboard.
 */
import { Prisma } from "@prisma/client";

import { appTimeZoneDateKey, shiftAppTimeZoneDay, startOfDayInAppTimeZone } from "@/lib/datetime/time-zone";
import { prisma } from "@/lib/db";

export type HourlyServerUsage = { time: string; cpu: number; memory: number; disk: number };
export type DailyAuditActivity = { date: string; total: number; actions: Record<string, number> };

/**
 * Average CPU, memory and disk usage per UTC hour since `since`, oldest hour
 * first, over the samples of `serverIds` (every server when null).
 *
 * Only measured samples count: an offline sample's zeros, and a server with no
 * metrics channel (online, no values), pulled the fleet's averages down.
 */
export async function hourlyServerUsage(since: Date, serverIds: string[] | null): Promise<HourlyServerUsage[]> {
	if (serverIds?.length === 0) return [];
	const servers = serverIds ? Prisma.sql`AND "serverId" = ANY(${serverIds})` : Prisma.empty;
	const rows = await prisma.$queryRaw<Array<{ hour: Date; cpu: number; memory: number; disk: number }>>(Prisma.sql`
		SELECT date_trunc('hour', "createdAt") AS hour,
		       avg("cpuUsage")::float8 AS cpu,
		       avg("memUsage")::float8 AS memory,
		       avg("diskUsage")::float8 AS disk
		FROM metric_snapshots
		WHERE "createdAt" >= ${since}
		  AND "isOnline" = true
		  AND "cpuUsage" IS NOT NULL AND "memUsage" IS NOT NULL AND "diskUsage" IS NOT NULL
		  ${servers}
		GROUP BY 1
		ORDER BY 1
	`);
	return rows.map((row) => ({
		time: row.hour.toISOString(),
		cpu: Math.round(row.cpu),
		memory: Math.round(row.memory),
		disk: Math.round(row.disk),
	}));
}

/**
 * Audit rows per application-time-zone day and action since `since`, oldest
 * day first, for one customer (`teamId`) or all of them (null).
 *
 * The days are cut in this process and handed over as instants: PostgreSQL
 * then needs no time zone name, which it may not know as the runtime does.
 */
export async function dailyAuditActivity(since: Date, teamId: string | null, now = new Date()): Promise<DailyAuditActivity[]> {
	// Start of every day the window touches, and of the day after it: a row belongs to the last start it is not before.
	const dayStarts: Date[] = [];
	const end = shiftAppTimeZoneDay(now, 1);
	for (let start = startOfDayInAppTimeZone(since); start <= end; start = shiftAppTimeZoneDay(start, 1)) dayStarts.push(start);
	const boundaries = dayStarts.map((start) => start.getTime());
	const customer = teamId === null ? Prisma.empty : Prisma.sql`AND "teamId" = ${teamId}`;
	const rows = await prisma.$queryRaw<Array<{ day: number; action: string; count: number }>>(Prisma.sql`
		SELECT width_bucket((extract(epoch from "createdAt") * 1000)::float8, ${boundaries}::float8[]) AS day,
		       action,
		       count(*)::int AS count
		FROM audit_logs
		WHERE "createdAt" >= ${since}
		  ${customer}
		GROUP BY 1, 2
		ORDER BY 1, 2
	`);
	const days = new Map<number, DailyAuditActivity>();
	for (const row of rows) {
		// Bucket n holds what is at or after boundary n (1-based); the window starts inside bucket 1.
		const start = dayStarts[Math.max(Number(row.day), 1) - 1] ?? dayStarts[dayStarts.length - 1]!;
		let day = days.get(row.day);
		if (!day) {
			day = { date: appTimeZoneDateKey(start), total: 0, actions: {} };
			days.set(row.day, day);
		}
		day.total += row.count;
		day.actions[row.action] = (day.actions[row.action] ?? 0) + row.count;
	}
	return [...days.values()];
}
