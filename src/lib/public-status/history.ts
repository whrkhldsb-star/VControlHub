/**
 * Public node history: time-bucketed in PostgreSQL, bounded in points,
 * with explicit gaps.
 *
 * - Resources: average CPU / memory / disk of the *online* samples per
 *   bucket; buckets with only offline samples carry null values (a gap),
 *   never zeros.
 * - Network: bytes per second recomputed from consecutive interface
 *   counters with LAG — a counter that went down (reboot) or a gap longer
 *   than MAX_RATE_GAP_SECONDS yields no rate for that step.
 * - Latency: Hub-to-node TCP connect time from the sampler's probe; failed
 *   probes are counted, not drawn as a value; samples without a probe
 *   (fresh Agent reports) are "not measured".
 * - Coverage: each sample covers the time until the next sample, at most
 *   twice its recorded interval (legacy rows: the former fixed 5 minutes).
 *   Time not covered is unknown, not up and not down.
 */
import { prisma } from "@/lib/db";
import { LEGACY_SAMPLE_INTERVAL_SECONDS } from "./status";
import type {
	PublicAvailabilityWindow,
	PublicHistoryPoint,
	PublicHistoryRange,
	PublicLatencyPoint,
	PublicNetworkPoint,
} from "./types";

export const RANGE_SECONDS: Record<PublicHistoryRange, number> = {
	"1h": 3_600,
	"6h": 21_600,
	"24h": 86_400,
	"7d": 604_800,
};
export const MAX_POINTS = 360;
export const MIN_BUCKET_SECONDS = 60;
export const MAX_RATE_GAP_SECONDS = 3_600;
/** Below this share of covered time a percentage is flagged as insufficient. */
export const MIN_COVERAGE = 0.5;

export function bucketSecondsFor(range: PublicHistoryRange): number {
	return Math.max(MIN_BUCKET_SECONDS, Math.ceil(RANGE_SECONDS[range] / MAX_POINTS));
}

type Timed = { t: string };

/**
 * Insert a null point after any bucket followed by silence longer than
 * `maxGapSeconds`, so a chart draws a break instead of a line across a
 * period with no data. Also bounds the output to `maxPoints`.
 */
export function insertGaps<T extends Timed>(points: T[], maxGapSeconds: number, makeGap: (t: string) => T, maxPoints = MAX_POINTS * 2): T[] {
	const out: T[] = [];
	for (let i = 0; i < points.length; i++) {
		const point = points[i]!;
		out.push(point);
		const next = points[i + 1];
		if (!next) continue;
		const gap = (Date.parse(next.t) - Date.parse(point.t)) / 1000;
		if (gap > maxGapSeconds) {
			out.push(makeGap(new Date(Date.parse(point.t) + Math.round(maxGapSeconds / 2) * 1000).toISOString()));
		}
	}
	return out.slice(-maxPoints);
}

type ResourceRow = {
	b: Date;
	cpu: number | null;
	mem: number | null;
	disk: number | null;
	online: bigint | number;
	offline: bigint | number;
	probe_ok: bigint | number;
	probe_failed: bigint | number;
	rtt_avg: number | null;
	rtt_min: number | null;
	rtt_max: number | null;
	interval_s: number | null;
};

function n(value: bigint | number | null | undefined): number {
	if (value === null || value === undefined) return 0;
	return typeof value === "bigint" ? Number(value) : value;
}

function r1(value: number | null): number | null {
	return value === null ? null : Math.round(value * 10) / 10;
}

export async function queryResourceBuckets(serverId: string, from: Date, to: Date, bucketSeconds: number) {
	return prisma.$queryRaw<ResourceRow[]>`
		SELECT
			date_bin(make_interval(secs => ${bucketSeconds}::float8), "createdAt", ${from}::timestamp) AS b,
			avg("cpuUsage") FILTER (WHERE "isOnline") AS cpu,
			avg("memUsage") FILTER (WHERE "isOnline") AS mem,
			avg("diskUsage") FILTER (WHERE "isOnline") AS disk,
			count(*) FILTER (WHERE "isOnline") AS online,
			count(*) FILTER (WHERE NOT "isOnline") AS offline,
			count(*) FILTER (WHERE "probeStatus" = 'ok') AS probe_ok,
			count(*) FILTER (WHERE "probeStatus" = 'failed') AS probe_failed,
			avg("probeLatencyMs") FILTER (WHERE "probeStatus" = 'ok') AS rtt_avg,
			min("probeLatencyMs") FILTER (WHERE "probeStatus" = 'ok') AS rtt_min,
			max("probeLatencyMs") FILTER (WHERE "probeStatus" = 'ok') AS rtt_max,
			max(COALESCE("intervalSeconds", ${LEGACY_SAMPLE_INTERVAL_SECONDS}))::float8 AS interval_s
		FROM "metric_snapshots"
		WHERE "serverId" = ${serverId} AND "createdAt" >= ${from}::timestamp AND "createdAt" < ${to}::timestamp
		GROUP BY 1
		ORDER BY 1
		LIMIT ${MAX_POINTS + 2}`;
}

type NetworkRow = { b: Date; rx: number | null; tx: number | null };

export async function queryNetworkBuckets(serverId: string, from: Date, to: Date, bucketSeconds: number) {
	// Look back one rate gap so the first in-window sample can have a baseline.
	const lookback = new Date(from.getTime() - MAX_RATE_GAP_SECONDS * 1000);
	return prisma.$queryRaw<NetworkRow[]>`
		SELECT b, avg(rx) AS rx, avg(tx) AS tx
		FROM (
			SELECT
				date_bin(make_interval(secs => ${bucketSeconds}::float8), "sampledAt", ${from}::timestamp) AS b,
				CASE WHEN prev_rx IS NOT NULL AND "rxBytes" >= prev_rx AND dt > 0 AND dt <= ${MAX_RATE_GAP_SECONDS}
					THEN ("rxBytes" - prev_rx)::float8 / dt END AS rx,
				CASE WHEN prev_tx IS NOT NULL AND "txBytes" >= prev_tx AND dt > 0 AND dt <= ${MAX_RATE_GAP_SECONDS}
					THEN ("txBytes" - prev_tx)::float8 / dt END AS tx,
				"sampledAt"
			FROM (
				SELECT "sampledAt", "rxBytes", "txBytes",
					lag("rxBytes") OVER w AS prev_rx,
					lag("txBytes") OVER w AS prev_tx,
					EXTRACT(EPOCH FROM ("sampledAt" - lag("sampledAt") OVER w))::float8 AS dt
				FROM "traffic_snapshots"
				WHERE "source" = 'server' AND "serverId" = ${serverId}
					AND "sampledAt" >= ${lookback}::timestamp AND "sampledAt" < ${to}::timestamp
				WINDOW w AS (PARTITION BY "iface" ORDER BY "sampledAt")
			) steps
			WHERE "sampledAt" >= ${from}::timestamp
		) rated
		GROUP BY b
		HAVING count(rx) > 0 OR count(tx) > 0
		ORDER BY b
		LIMIT ${MAX_POINTS + 2}`;
}

type CoverageRow = {
	samples: bigint | number;
	covered: number | null;
	online_covered: number | null;
	intervals: number | null;
};

/**
 * Covered and online-covered seconds in [from, to): each sample covers the
 * time to the next sample (or to `to`), capped at twice its interval.
 */
export async function queryCoverage(serverId: string, from: Date, to: Date): Promise<{ samples: number; covered: number; onlineCovered: number; interval: number | null }> {
	const rows = await prisma.$queryRaw<CoverageRow[]>`
		SELECT
			count(*) AS samples,
			sum(span) AS covered,
			sum(span) FILTER (WHERE "isOnline") AS online_covered,
			max(iv)::float8 AS intervals
		FROM (
			SELECT "isOnline",
				COALESCE("intervalSeconds", ${LEGACY_SAMPLE_INTERVAL_SECONDS}) AS iv,
				LEAST(
					EXTRACT(EPOCH FROM (COALESCE(lead("createdAt") OVER (ORDER BY "createdAt"), ${to}::timestamp) - "createdAt")),
					2 * COALESCE("intervalSeconds", ${LEGACY_SAMPLE_INTERVAL_SECONDS})
				)::float8 AS span
			FROM "metric_snapshots"
			WHERE "serverId" = ${serverId} AND "createdAt" >= ${from}::timestamp AND "createdAt" < ${to}::timestamp
		) s`;
	const row = rows[0];
	return {
		samples: n(row?.samples),
		covered: Math.max(0, row?.covered ?? 0),
		onlineCovered: Math.max(0, row?.online_covered ?? 0),
		interval: row?.intervals ?? null,
	};
}

export function availabilityFromCoverage(coverage: { samples: number; covered: number; onlineCovered: number }, windowSeconds: number): PublicAvailabilityWindow {
	const coveredShare = windowSeconds > 0 ? Math.min(1, coverage.covered / windowSeconds) : 0;
	const percent = coverage.covered > 0 ? Math.round((coverage.onlineCovered / coverage.covered) * 10_000) / 100 : null;
	return {
		percent,
		coveragePercent: Math.round(coveredShare * 1000) / 10,
		samples: coverage.samples,
		sufficient: percent !== null && coveredShare >= MIN_COVERAGE,
	};
}

export function shapeResourcePoints(rows: ResourceRow[], bucketSeconds: number, interval: number) {
	const resources: PublicHistoryPoint[] = rows.map((row) => ({
		t: row.b.toISOString(),
		cpu: r1(row.cpu),
		memory: r1(row.mem),
		disk: r1(row.disk),
		online: n(row.online),
		offline: n(row.offline),
	}));
	const latency: PublicLatencyPoint[] = rows
		.filter((row) => n(row.probe_ok) + n(row.probe_failed) > 0)
		.map((row) => ({
			t: row.b.toISOString(),
			avg: r1(row.rtt_avg),
			min: r1(row.rtt_min),
			max: r1(row.rtt_max),
			ok: n(row.probe_ok),
			failed: n(row.probe_failed),
		}));
	const maxGap = 2 * Math.max(bucketSeconds, interval) + 1;
	return {
		resources: insertGaps(resources, maxGap, (t) => ({ t, cpu: null, memory: null, disk: null, online: 0, offline: 0 })),
		latency: insertGaps(latency, maxGap, (t) => ({ t, avg: null, min: null, max: null, ok: 0, failed: 0 })),
		probes: latency.reduce((sum, point) => sum + point.ok + point.failed, 0),
		failed: latency.reduce((sum, point) => sum + point.failed, 0),
	};
}

export function shapeNetworkPoints(rows: NetworkRow[], bucketSeconds: number, interval: number): PublicNetworkPoint[] {
	const points = rows.map((row) => ({
		t: row.b.toISOString(),
		rx: row.rx === null ? null : Math.round(row.rx),
		tx: row.tx === null ? null : Math.round(row.tx),
	}));
	return insertGaps(points, 2 * Math.max(bucketSeconds, interval) + 1, (t) => ({ t, rx: null, tx: null }));
}
