import { promises as fs } from "node:fs";
import path from "node:path";

import type {
	QaReportTrendCard,
	QaReportTrendDailyBucket,
	QaReportTrendModuleRow,
	QaReportTrendRecentRun,
	QaReportTrends,
} from "./dto";

const HERMES_DIRNAME = ".hermes";
const AUTONOMOUS_MAINTENANCE_STATE_FILENAME = "autonomous-maintenance-state.json";
const TREND_DAY_BUCKET_COUNT = 7;
const TREND_RECENT_RUN_COUNT = 5;
const TRUNCATE_TREND_SUMMARY_CHARS = 160;

function truncate(value: string, max: number): string {
	if (value.length <= max) return value;
	return `${value.slice(0, max - 1).trimEnd()}…`;
}

function coerceString(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function coerceIsoDate(value: unknown): string | undefined {
	if (typeof value !== "string" || value.length === 0) return undefined;
	const ts = Date.parse(value);
	if (Number.isNaN(ts)) return undefined;
	return new Date(ts).toISOString();
}

function projectRoot(): string {
	return process.cwd();
}

function hermesPath(filename: string): string {
	return path.join(projectRoot(), HERMES_DIRNAME, filename);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
	try {
		const raw = await fs.readFile(filePath, "utf8");
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

function summariseSummary(value: string, max = 240): string {
	const cleaned = value.replace(/\s+/g, " ").trim();
	return truncate(cleaned, max);
}

type AutonomousMaintenanceState = {
	module_queue?: unknown[];
	last_module?: string;
	completed_runs?: unknown[];
	updatedAt?: string;
};

async function loadAutonomousMaintenanceState(): Promise<AutonomousMaintenanceState | null> {
	return readJsonFile<AutonomousMaintenanceState>(hermesPath(AUTONOMOUS_MAINTENANCE_STATE_FILENAME));
}

function isSuccessfulRun(result: unknown): boolean {
	return typeof result === "string" && result.startsWith("deployed_committed_pushed");
}

function toUtcDayKey(value: string): string | null {
	const ts = Date.parse(value);
	if (Number.isNaN(ts)) return null;
	return new Date(ts).toISOString().slice(0, 10);
}

function emptyTrends(): QaReportTrends {
	return {
		cards: [],
		dailyBuckets: [],
		moduleCoverage: [],
		recentRuns: [],
		lastFailure: null,
		sourceUpdatedAt: null,
	};
}

export async function computeQaReportTrends(): Promise<QaReportTrends> {
	const state = await loadAutonomousMaintenanceState();
	const runs = Array.isArray(state?.completed_runs)
		? (state!.completed_runs as Record<string, unknown>[]).filter(
				(row): row is Record<string, unknown> => Boolean(row) && typeof row === "object",
			)
		: [];

	if (runs.length === 0) {
		return emptyTrends();
	}

	const queuedModules = Array.isArray(state?.module_queue)
		? (state!.module_queue as unknown[]).filter((m): m is string => typeof m === "string")
		: [];
	const queuedSet = new Set(queuedModules);

	// Sort runs newest first by timestamp
	const parsed = runs
		.map((row) => {
			const ts = coerceIsoDate(row.timestamp_utc);
			const moduleName = coerceString(row.module);
			const result = coerceString(row.result, "unknown");
			return { row, ts, moduleName, result };
		})
		.filter((entry) => entry.ts !== undefined) as Array<{
		row: Record<string, unknown>;
		ts: string;
		moduleName: string;
		result: string;
	}>;
	parsed.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

	// Daily buckets: last 7 UTC days
	const bucketByDay = new Map<string, { total: number; success: number; failed: number }>();
	const todayKey = toUtcDayKey(new Date().toISOString()) ?? new Date().toISOString().slice(0, 10);
	// Seed 7 day keys so empty days still render in order
	for (let offset = TREND_DAY_BUCKET_COUNT - 1; offset >= 0; offset -= 1) {
		const d = new Date(`${todayKey}T00:00:00.000Z`);
		d.setUTCDate(d.getUTCDate() - offset);
		const key = d.toISOString().slice(0, 10);
		bucketByDay.set(key, { total: 0, success: 0, failed: 0 });
	}
	for (const entry of parsed) {
		const dayKey = toUtcDayKey(entry.ts);
		if (!dayKey) continue;
		const bucket = bucketByDay.get(dayKey);
		if (!bucket) continue; // outside the 7-day window
		bucket.total += 1;
		if (isSuccessfulRun(entry.result)) bucket.success += 1;
		else bucket.failed += 1;
	}
	const dailyBuckets: QaReportTrendDailyBucket[] = Array.from(bucketByDay.entries())
		.map(([day, value]) => ({ day, ...value }))
		.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

	// Module coverage
	const moduleStats = new Map<string, { lastVisitedAt: string | null; visitCount: number }>();
	for (const queued of queuedModules) {
		moduleStats.set(queued, { lastVisitedAt: null, visitCount: 0 });
	}
	for (const entry of parsed) {
		if (!entry.moduleName) continue;
		const existing = moduleStats.get(entry.moduleName) ?? { lastVisitedAt: null, visitCount: 0 };
		existing.visitCount += 1;
		if (!existing.lastVisitedAt || existing.lastVisitedAt < entry.ts) {
			existing.lastVisitedAt = entry.ts;
		}
		moduleStats.set(entry.moduleName, existing);
	}
	const moduleCoverage: QaReportTrendModuleRow[] = Array.from(moduleStats.entries())
		.map(([moduleName, stats]) => ({ module: moduleName, ...stats }))
		.sort((a, b) => {
			if (a.visitCount !== b.visitCount) return b.visitCount - a.visitCount;
			if (a.lastVisitedAt && b.lastVisitedAt) return a.lastVisitedAt < b.lastVisitedAt ? 1 : -1;
			if (a.lastVisitedAt) return -1;
			if (b.lastVisitedAt) return 1;
			return a.module.localeCompare(b.module);
		});

	// Recent runs (last N)
	const recentRuns: QaReportTrendRecentRun[] = parsed.slice(0, TREND_RECENT_RUN_COUNT).map((entry) => ({
		timestamp: entry.ts,
		module: entry.moduleName || "(未命名模块)",
		result: entry.result,
		isSuccess: isSuccessfulRun(entry.result),
		summary: summariseSummary(coerceString(entry.row.summary, "(无摘要)"), TRUNCATE_TREND_SUMMARY_CHARS),
	}));

	// Headline counts
	const totalRuns = parsed.length;
	const successCount = parsed.filter((entry) => isSuccessfulRun(entry.result)).length;
	const failureCount = totalRuns - successCount;
	const successRate = totalRuns === 0 ? 0 : Math.round((successCount / totalRuns) * 100);
	const modulesCovered = moduleCoverage.filter((row) => row.visitCount > 0).length;
	const coverageDenominator = queuedSet.size === 0 ? moduleStats.size : queuedSet.size;
	const coverageTone: QaReportTrendCard["tone"] =
		coverageDenominator === 0
			? "neutral"
			: modulesCovered === coverageDenominator
				? "success"
				: "info";
	const lastFailureEntry = parsed.find((entry) => !isSuccessfulRun(entry.result));
	const lastFailure =
		lastFailureEntry !== undefined
			? {
					timestamp: lastFailureEntry.ts,
					module: lastFailureEntry.moduleName || "(未命名模块)",
					summary: summariseSummary(
						coerceString(lastFailureEntry.row.summary, "(无摘要)"),
						TRUNCATE_TREND_SUMMARY_CHARS,
					),
				}
			: null;

	const cards: QaReportTrendCard[] = [
		{
			id: "totalRuns",
			label: "总 tick 数",
			value: String(totalRuns),
			raw: totalRuns,
			tone: totalRuns === 0 ? "neutral" : "info",
			caption:
				failureCount === 0
					? `全 ${successCount} 次成功`
					: `成功 ${successCount} · 失败 ${failureCount}`,
		},
		{
			id: "successRate",
			label: "成功率",
			value: totalRuns === 0 ? "—" : `${successRate}%`,
			raw: successRate,
			tone:
				totalRuns === 0
					? "neutral"
					: successRate >= 90
						? "success"
						: successRate >= 60
							? "info"
							: "warn",
			caption: totalRuns === 0 ? "暂无历史" : `${successCount}/${totalRuns} 次 deploy_committed_pushed`,
		},
		{
			id: "moduleCoverage",
			label: "模块覆盖",
			value: `${modulesCovered}/${coverageDenominator}`,
			raw: modulesCovered,
			tone: coverageTone,
			caption:
				coverageDenominator === 0
					? "无 module_queue"
					: `已巡检 ${modulesCovered} 个，剩余 ${coverageDenominator - modulesCovered} 个`,
		},
		{
			id: "lastFailure",
			label: "最近失败",
			value: lastFailure ? lastFailure.module : "无",
			raw: failureCount,
			tone: lastFailure ? "warn" : "success",
			caption: lastFailure ? lastFailure.summary : "近 N 次全成功",
		},
	];

	return {
		cards,
		dailyBuckets,
		moduleCoverage,
		recentRuns,
		lastFailure,
		sourceUpdatedAt: typeof state?.updatedAt === "string" ? state!.updatedAt : null,
	};
}
