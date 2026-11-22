/**
 * Writer of `server_metric_latest` — the one-row-per-server table the status
 * board reads instead of probing hosts.
 *
 * Two existing producers call it: the fleet health sampler (every sampling
 * interval, SSH and stale-Agent nodes, plus the TCP probe result) and Agent
 * metric reports (about once a minute). Both may describe the same Agent
 * sample, so the upsert is idempotent on `metricsAt`: a sample that is not
 * newer than the stored one changes nothing.
 *
 * Rates and the monthly counters are derived in the same statement from the
 * stored previous counters, so concurrent writers cannot interleave a
 * read-modify-write:
 * - rate (bytes/s) only between two samples of the same interface, counter
 *   not decreasing and the gap no longer than 3 report intervals; otherwise
 *   NULL (unknown), never 0 and never a negative or long-run average value;
 * - the period (calendar month) counters add each non-negative delta; after a
 *   counter reset (reboot) the new counter value is the traffic since boot;
 *   an interface change contributes nothing; a new month restarts at 0.
 */
import { Prisma } from "@prisma/client";

import { withSamplingClaim, type SamplingClaim } from "@/lib/monitoring/sampling-claim";
import { startOfMonthInAppTimeZone } from "@/lib/datetime/time-zone";
import { createLogger } from "@/lib/logging";
import { counterOrNull, pgNonnegativeInt, type NormalizedMetrics } from "./normalize";

export type LatestMetricInput = {
	serverId: string;
	/** When the reachability verdict below was made. */
	checkedAt: Date;
	online: boolean;
	offlineReason?: "unreachable" | "collect_failed" | null;
	/** Expected seconds between reports from this writer. */
	intervalSeconds: number;
	/** Present only when this verdict came with a usable metric sample. */
	metrics?: {
		sampledAt: Date;
		source: "agent" | "ssh";
		values: NormalizedMetrics;
	} | null;
	/** Present only when a Hub-to-node TCP probe ran for this verdict. */
	probe?: { at: Date; ok: boolean; latencyMs: number | null } | null;
};

/** Rows per statement; ~32 bind parameters each keeps far below PG's 65535. */
const CHUNK = 200;

function rowSql(input: LatestMetricInput) {
	const m = input.metrics ?? null;
	const v = m?.values ?? null;
	const rx = counterOrNull(v?.netRxBytes);
	const tx = counterOrNull(v?.netTxBytes);
	const periodStart = m && v?.netIface && (rx !== null || tx !== null) ? startOfMonthInAppTimeZone(m.sampledAt) : null;
	return Prisma.sql`(
		${input.serverId}::text, ${input.checkedAt}::timestamp, ${input.online}::boolean, ${input.offlineReason ?? null}::text,
		${m?.sampledAt ?? null}::timestamp, ${m?.source ?? null}::text, ${pgNonnegativeInt(Math.max(1, Math.round(input.intervalSeconds)))}::int,
		${v?.cpuUsage ?? null}::float8, ${pgNonnegativeInt(v?.cpuCores)}::int,
		${v?.load1 ?? null}::float8, ${v?.load5 ?? null}::float8, ${v?.load15 ?? null}::float8,
		${v?.memUsage ?? null}::float8, ${pgNonnegativeInt(v?.memUsedMb)}::int, ${pgNonnegativeInt(v?.memTotalMb)}::int,
		${v?.swapUsage ?? null}::float8, ${v?.diskUsage ?? null}::float8,
		${v?.diskUsedBytes ?? null}::float8, ${v?.diskTotalBytes ?? null}::float8,
		${pgNonnegativeInt(v?.uptimeSeconds)}::int, ${v?.netIface ?? null}::text,
		${rx}::bigint, ${tx}::bigint,
		${periodStart}::timestamp,
		${input.probe?.at ?? null}::timestamp, ${input.probe ? input.probe.ok : null}::boolean,
		${input.probe?.latencyMs ?? null}::float8,
		${v?.arch ?? null}::text, ${v?.kernelVersion ?? null}::text, ${v?.osName ?? null}::text,
		${v?.cpuModel ?? null}::text, ${v?.virtualization ?? null}::text,
		${pgNonnegativeInt(v?.processCount)}::int, ${pgNonnegativeInt(v?.tcpConnections)}::int, ${pgNonnegativeInt(v?.udpConnections)}::int,
		(now() AT TIME ZONE 'UTC')
	)`;
}

/**
 * Upsert verdicts (and samples) for many servers. Rows for servers that no
 * longer exist are skipped by the foreign-key join instead of failing the batch.
 */
export async function writeLatestMetrics(inputs: LatestMetricInput[], claim?: SamplingClaim): Promise<number> {
	let written = 0;
	for (const wave of waves(inputs)) written += await writeWave(wave, claim);
	return written;
}

/**
 * One statement cannot upsert the same row twice, so several inputs for one
 * server are applied in successive statements, oldest verdict first.
 */
function waves(inputs: LatestMetricInput[]): LatestMetricInput[][] {
	const ordered = [...inputs].sort((a, b) => a.checkedAt.getTime() - b.checkedAt.getTime());
	const result: LatestMetricInput[][] = [];
	const depth = new Map<string, number>();
	for (const input of ordered) {
		const index = depth.get(input.serverId) ?? 0;
		depth.set(input.serverId, index + 1);
		(result[index] ??= []).push(input);
	}
	return result;
}

async function writeWave(inputs: LatestMetricInput[], claim?: SamplingClaim): Promise<number> {
	let written = 0;
	for (let i = 0; i < inputs.length; i += CHUNK) {
		const chunk = inputs.slice(i, i + CHUNK);
		written += await writeChunk(chunk, claim);
	}
	return written;
}

const logger = createLogger("public-status:latest");

async function writeChunk(chunk: LatestMetricInput[], claim?: SamplingClaim): Promise<number> {
	try {
		// Isolating a malformed chunk needs a fresh transaction after the failed statement.
		return await withSamplingClaim(claim, (db) => db.$executeRaw`
			INSERT INTO "server_metric_latest" AS t (
				"serverId", "checkedAt", "online", "offlineReason",
				"metricsAt", "metricsSource", "intervalSeconds",
				"cpuUsage", "cpuCores", "load1", "load5", "load15",
				"memUsage", "memUsedMb", "memTotalMb", "swapUsage", "diskUsage",
				"diskUsedBytes", "diskTotalBytes", "uptimeSeconds", "netIface",
				"netRxBytes", "netTxBytes", "periodStart",
				"probeAt", "probeOk", "probeLatencyMs",
				"arch", "kernelVersion", "osName", "cpuModel", "virtualization",
				"processCount", "tcpConnections", "udpConnections", "updatedAt",
				"periodSince", "periodRxBytes", "periodTxBytes"
			)
			SELECT v.*, CASE WHEN v."periodStart" IS NOT NULL THEN v."metricsAt" END, 0::bigint, 0::bigint
			FROM (VALUES ${Prisma.join(chunk.map(rowSql))}) AS v (
				"serverId", "checkedAt", "online", "offlineReason",
				"metricsAt", "metricsSource", "intervalSeconds",
				"cpuUsage", "cpuCores", "load1", "load5", "load15",
				"memUsage", "memUsedMb", "memTotalMb", "swapUsage", "diskUsage",
				"diskUsedBytes", "diskTotalBytes", "uptimeSeconds", "netIface",
				"netRxBytes", "netTxBytes", "periodStart",
				"probeAt", "probeOk", "probeLatencyMs",
				"arch", "kernelVersion", "osName", "cpuModel", "virtualization",
				"processCount", "tcpConnections", "udpConnections", "updatedAt"
			)
			JOIN "servers" s ON s."id" = v."serverId"
			ON CONFLICT ("serverId") DO UPDATE SET
				"checkedAt" = CASE WHEN EXCLUDED."checkedAt" >= t."checkedAt" THEN EXCLUDED."checkedAt" ELSE t."checkedAt" END,
				"online" = CASE WHEN EXCLUDED."checkedAt" >= t."checkedAt" THEN EXCLUDED."online" ELSE t."online" END,
				"offlineReason" = CASE WHEN EXCLUDED."checkedAt" >= t."checkedAt" THEN EXCLUDED."offlineReason" ELSE t."offlineReason" END,
				"intervalSeconds" = CASE WHEN EXCLUDED."checkedAt" >= t."checkedAt" THEN EXCLUDED."intervalSeconds" ELSE t."intervalSeconds" END,
				"probeAt" = CASE WHEN EXCLUDED."probeAt" IS NOT NULL AND (t."probeAt" IS NULL OR EXCLUDED."probeAt" > t."probeAt") THEN EXCLUDED."probeAt" ELSE t."probeAt" END,
				"probeOk" = CASE WHEN EXCLUDED."probeAt" IS NOT NULL AND (t."probeAt" IS NULL OR EXCLUDED."probeAt" > t."probeAt") THEN EXCLUDED."probeOk" ELSE t."probeOk" END,
				"probeLatencyMs" = CASE WHEN EXCLUDED."probeAt" IS NOT NULL AND (t."probeAt" IS NULL OR EXCLUDED."probeAt" > t."probeAt") THEN EXCLUDED."probeLatencyMs" ELSE t."probeLatencyMs" END,
				"rxRateBps" = CASE
					WHEN NOT (EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt")) THEN t."rxRateBps"
					WHEN t."netIface" IS NOT DISTINCT FROM EXCLUDED."netIface" AND t."netRxBytes" IS NOT NULL AND EXCLUDED."netRxBytes" >= t."netRxBytes"
						AND EXTRACT(EPOCH FROM (EXCLUDED."metricsAt" - t."metricsAt")) <= 3 * GREATEST(EXCLUDED."intervalSeconds", 60)
					THEN (EXCLUDED."netRxBytes" - t."netRxBytes")::float8 / EXTRACT(EPOCH FROM (EXCLUDED."metricsAt" - t."metricsAt"))
					ELSE NULL END,
				"txRateBps" = CASE
					WHEN NOT (EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt")) THEN t."txRateBps"
					WHEN t."netIface" IS NOT DISTINCT FROM EXCLUDED."netIface" AND t."netTxBytes" IS NOT NULL AND EXCLUDED."netTxBytes" >= t."netTxBytes"
						AND EXTRACT(EPOCH FROM (EXCLUDED."metricsAt" - t."metricsAt")) <= 3 * GREATEST(EXCLUDED."intervalSeconds", 60)
					THEN (EXCLUDED."netTxBytes" - t."netTxBytes")::float8 / EXTRACT(EPOCH FROM (EXCLUDED."metricsAt" - t."metricsAt"))
					ELSE NULL END,
				"rateIntervalSeconds" = CASE
					WHEN NOT (EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt")) THEN t."rateIntervalSeconds"
					WHEN t."metricsAt" IS NOT NULL THEN EXTRACT(EPOCH FROM (EXCLUDED."metricsAt" - t."metricsAt"))::float8
					ELSE NULL END,
				"periodRxBytes" = CASE
					WHEN EXCLUDED."periodStart" IS NULL THEN t."periodRxBytes"
					WHEN NOT (EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt")) THEN t."periodRxBytes"
					WHEN t."periodStart" IS DISTINCT FROM EXCLUDED."periodStart" THEN 0
					WHEN EXCLUDED."netRxBytes" IS NULL OR t."netRxBytes" IS NULL OR t."netIface" IS DISTINCT FROM EXCLUDED."netIface" THEN t."periodRxBytes"
					WHEN EXCLUDED."netRxBytes" >= t."netRxBytes" THEN t."periodRxBytes" + (EXCLUDED."netRxBytes" - t."netRxBytes")
					ELSE t."periodRxBytes" + EXCLUDED."netRxBytes" END,
				"periodTxBytes" = CASE
					WHEN EXCLUDED."periodStart" IS NULL THEN t."periodTxBytes"
					WHEN NOT (EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt")) THEN t."periodTxBytes"
					WHEN t."periodStart" IS DISTINCT FROM EXCLUDED."periodStart" THEN 0
					WHEN EXCLUDED."netTxBytes" IS NULL OR t."netTxBytes" IS NULL OR t."netIface" IS DISTINCT FROM EXCLUDED."netIface" THEN t."periodTxBytes"
					WHEN EXCLUDED."netTxBytes" >= t."netTxBytes" THEN t."periodTxBytes" + (EXCLUDED."netTxBytes" - t."netTxBytes")
					ELSE t."periodTxBytes" + EXCLUDED."netTxBytes" END,
				"periodSince" = CASE
					WHEN EXCLUDED."periodStart" IS NULL THEN t."periodSince"
					WHEN NOT (EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt")) THEN t."periodSince"
					WHEN t."periodStart" IS DISTINCT FROM EXCLUDED."periodStart" THEN EXCLUDED."metricsAt"
					ELSE COALESCE(t."periodSince", EXCLUDED."metricsAt") END,
				"periodStart" = CASE WHEN EXCLUDED."periodStart" IS NOT NULL AND EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN EXCLUDED."periodStart" ELSE t."periodStart" END,
				"metricsSource" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN EXCLUDED."metricsSource" ELSE t."metricsSource" END,
				"cpuUsage" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN EXCLUDED."cpuUsage" ELSE t."cpuUsage" END,
				"cpuCores" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN EXCLUDED."cpuCores" ELSE t."cpuCores" END,
				"load1" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN EXCLUDED."load1" ELSE t."load1" END,
				"load5" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN EXCLUDED."load5" ELSE t."load5" END,
				"load15" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN EXCLUDED."load15" ELSE t."load15" END,
				"memUsage" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN EXCLUDED."memUsage" ELSE t."memUsage" END,
				"memUsedMb" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN EXCLUDED."memUsedMb" ELSE t."memUsedMb" END,
				"memTotalMb" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN EXCLUDED."memTotalMb" ELSE t."memTotalMb" END,
				"swapUsage" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN EXCLUDED."swapUsage" ELSE t."swapUsage" END,
				"diskUsage" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN EXCLUDED."diskUsage" ELSE t."diskUsage" END,
				"diskUsedBytes" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN EXCLUDED."diskUsedBytes" ELSE t."diskUsedBytes" END,
				"diskTotalBytes" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN EXCLUDED."diskTotalBytes" ELSE t."diskTotalBytes" END,
				"uptimeSeconds" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN EXCLUDED."uptimeSeconds" ELSE t."uptimeSeconds" END,
				"netIface" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN EXCLUDED."netIface" ELSE t."netIface" END,
				"netRxBytes" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN EXCLUDED."netRxBytes" ELSE t."netRxBytes" END,
				"netTxBytes" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN EXCLUDED."netTxBytes" ELSE t."netTxBytes" END,
				-- Static facts survive a newer sample that lacks them (an older Agent);
				-- counts describe one sample and follow it, null included.
				"arch" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN COALESCE(EXCLUDED."arch", t."arch") ELSE t."arch" END,
				"kernelVersion" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN COALESCE(EXCLUDED."kernelVersion", t."kernelVersion") ELSE t."kernelVersion" END,
				"osName" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN COALESCE(EXCLUDED."osName", t."osName") ELSE t."osName" END,
				"cpuModel" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN COALESCE(EXCLUDED."cpuModel", t."cpuModel") ELSE t."cpuModel" END,
				"virtualization" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN COALESCE(EXCLUDED."virtualization", t."virtualization") ELSE t."virtualization" END,
				"processCount" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN EXCLUDED."processCount" ELSE t."processCount" END,
				"tcpConnections" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN EXCLUDED."tcpConnections" ELSE t."tcpConnections" END,
				"udpConnections" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN EXCLUDED."udpConnections" ELSE t."udpConnections" END,
				"metricsAt" = CASE WHEN EXCLUDED."metricsAt" IS NOT NULL AND (t."metricsAt" IS NULL OR EXCLUDED."metricsAt" > t."metricsAt") THEN EXCLUDED."metricsAt" ELSE t."metricsAt" END,
				"updatedAt" = (now() AT TIME ZONE 'UTC')
		`);
	} catch (error) {
		// Only isolate malformed data. Infrastructure errors still reach the caller.
		const meta = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta : undefined;
		const adapter = meta?.driverAdapterError as { cause?: { originalCode?: string } } | undefined;
		const sqlState = String(adapter?.cause?.originalCode ?? meta?.code ?? "");
		if (!sqlState.startsWith("22") && !(error instanceof RangeError)) throw error;
		if (chunk.length === 1) {
			logger.warn("Skipped invalid latest metric row", { serverId: chunk[0]!.serverId, sqlState });
			return 0;
		}
		const mid = Math.floor(chunk.length / 2);
		return await writeChunk(chunk.slice(0, mid), claim) + await writeChunk(chunk.slice(mid), claim);
	}
}
