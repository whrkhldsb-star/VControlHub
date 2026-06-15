/**
 * TR-029: read-only service that aggregates QA evidence from the
 * structured JSON files the maintenance loop and QA loop write under
 * `.hermes/` on the application host. No database access — the goal is
 * to make the on-disk history browsable from inside the app so ops
 * staff do not need shell access to `.hermes/` to read past runs.
 *
 * The shape of the on-disk state is documented in
 * `src/lib/qa-reports/dto.ts`. If the on-disk shape drifts this module
 * is the single place to update the parser. The function returns
 * `QaReportsListResult` / `QaReportDetail` only — never raw prisma rows.
 *
 * All filesystem reads are wrapped in try/catch and degrade to empty
 * results when the file is missing or malformed. This is intentional:
 * the `/qa-reports` page is an internal convenience and must never
 * crash the surrounding dashboard if `.hermes/` is unreadable.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import type {
	QaReportDetail,
	QaReportEvidenceRow,
	QaReportKind,
	QaReportSummary,
	QaReportTrendCard,
	QaReportTrendDailyBucket,
	QaReportTrendModuleRow,
	QaReportTrendRecentRun,
	QaReportTrends,
	QaReportsListResult,
} from "./dto";

const HERMES_DIRNAME = ".hermes";
const REMEDIATION_STATE_FILENAME = "remediation-state.json";
const QA_LOOP_STATE_FILENAME = "qa-loop-state.json";
const AUTONOMOUS_MAINTENANCE_STATE_FILENAME = "autonomous-maintenance-state.json";

const TRUNCATE_SUMMARY_CHARS = 240;
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
  // `process.cwd()` is the project root in both `next dev` and
  // `next start` modes because `.hermes/` lives next to `package.json`.
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

function summariseSummary(value: string, max = TRUNCATE_SUMMARY_CHARS): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return truncate(cleaned, max);
}

function buildSliceSummary(entry: Record<string, unknown>): QaReportSummary | null {
  const id = coerceString(entry.id);
  if (!id) return null;
  const completedAt = coerceIsoDate(entry.completedAt) ?? new Date(0).toISOString();
  const summary = summariseSummary(coerceString(entry.summary, "(无摘要)"));
  const evidence = Array.isArray(entry.evidence) ? entry.evidence : [];
  return {
    id: `slice:${id}`,
    kind: "slice",
    title: `已闭环 slice · ${id}`,
    finishedAt: completedAt,
    status: "completed",
    summary,
    evidenceCount: evidence.length,
  };
}

function buildBlockerSummary(entry: Record<string, unknown>): QaReportSummary | null {
  const target = coerceString(entry.target);
  if (!target) return null;
  const resolvedAt = coerceIsoDate(entry.resolvedAt);
  const at = coerceIsoDate(entry.at);
  const finishedAt = resolvedAt ?? at ?? new Date(0).toISOString();
  const type = coerceString(entry.type, "blocker");
  const summary = summariseSummary(coerceString(entry.summary));
  return {
    id: `blocker:${target}:${finishedAt}`,
    kind: "blocker",
    title: `已解除 blocker · ${target}`,
    finishedAt,
    status: `resolved · ${type}`,
    summary: summary || "(无摘要)",
    evidenceCount: 1,
  };
}

function buildQaRunSummary(entry: Record<string, unknown>): QaReportSummary | null {
  const id = coerceString(entry.id);
  if (!id) return null;
  const finishedAt =
    coerceIsoDate(entry.finishedAt) ?? coerceIsoDate(entry.startedAt) ?? new Date(0).toISOString();
  const title = coerceString(entry.title, id);
  const status = coerceString(entry.status, "unknown");
  const summary = summariseSummary(coerceString(entry.summary));
  const evidenceMatrix = entry.evidenceMatrix;
  const evidenceCount =
    evidenceMatrix && typeof evidenceMatrix === "object"
      ? Object.keys(evidenceMatrix as Record<string, unknown>).length
      : 0;
  return {
    id: `qa_run:${id}`,
    kind: "qa_run",
    title: `QA loop · ${title}`,
    finishedAt,
    status,
    summary: summary || "(无摘要)",
    evidenceCount,
  };
}

function buildSliceDetail(
  summary: QaReportSummary,
  entry: Record<string, unknown>,
): QaReportDetail {
  const evidenceRows: QaReportEvidenceRow[] = Array.isArray(entry.evidence)
    ? (entry.evidence as Record<string, unknown>[])
        .map((row) => ({
          command: coerceString(row.command),
          result: coerceString(row.result),
        }))
        .filter((row) => row.command || row.result)
    : [];
  return {
    ...summary,
    sourceId: coerceString(entry.id, summary.id),
    evidence: evidenceRows,
  };
}

function buildBlockerDetail(
  summary: QaReportSummary,
  entry: Record<string, unknown>,
): QaReportDetail {
  const target = coerceString(entry.target, summary.id);
  const at = coerceIsoDate(entry.at);
  const resolution = coerceString(entry.resolution);
  const next = coerceString(entry.next);
  const evidenceRows: QaReportEvidenceRow[] = [];
  if (resolution) {
    evidenceRows.push({ command: "resolution", result: resolution });
  }
  if (next) {
    evidenceRows.push({ command: "next", result: next });
  }
  if (evidenceRows.length === 0) {
    evidenceRows.push({ command: "summary", result: coerceString(entry.summary) });
  }
  return {
    ...summary,
    sourceId: target,
    startedAt: at,
    evidence: evidenceRows,
    next: next || undefined,
  };
}

function buildQaRunDetail(
  summary: QaReportSummary,
  entry: Record<string, unknown>,
): QaReportDetail {
  const id = coerceString(entry.id, summary.id);
  const evidenceMatrix =
    entry.evidenceMatrix && typeof entry.evidenceMatrix === "object"
      ? (entry.evidenceMatrix as Record<string, unknown>)
      : {};
  const evidenceRows: QaReportEvidenceRow[] = Object.entries(evidenceMatrix).map(
    ([bucket, payload]) => ({
      command: bucket,
      result:
        typeof payload === "string"
          ? payload
          : Array.isArray(payload)
            ? payload.filter((item): item is string => typeof item === "string").join("\n")
            : "",
    }),
  );
  const changeContract = entry.changeContract;
  const contract =
    changeContract && typeof changeContract === "object"
      ? (changeContract as Record<string, unknown>)
      : null;
  return {
    ...summary,
    sourceId: id,
    startedAt: coerceIsoDate(entry.startedAt),
    evidence: evidenceRows,
    changeContract: contract
      ? {
          files: Array.isArray(contract.files)
            ? (contract.files as unknown[]).filter((file): file is string => typeof file === "string")
            : undefined,
          commit: typeof contract.commit === "string" ? contract.commit : undefined,
          notes: typeof contract.notes === "string" ? contract.notes : undefined,
        }
      : undefined,
  };
}

type RemediationState = {
  completed?: unknown[];
  resolvedBlockers?: unknown[];
  activeBlockers?: unknown[];
  updatedAt?: string;
  successfulRemediationRunsSinceFreshAudit?: number;
};

type QaLoopState = {
  lastRun?: Record<string, unknown>;
  runCounter?: number;
  updatedAt?: string;
};

async function loadRemediationState(): Promise<RemediationState | null> {
	return readJsonFile<RemediationState>(hermesPath(REMEDIATION_STATE_FILENAME));
}

async function loadQaLoopState(): Promise<QaLoopState | null> {
	return readJsonFile<QaLoopState>(hermesPath(QA_LOOP_STATE_FILENAME));
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

export async function listQaReports(): Promise<QaReportsListResult> {
	const [remediation, qaLoop, trends] = await Promise.all([
		loadRemediationState(),
		loadQaLoopState(),
		computeQaReportTrends(),
	]);

	const sliceRows = (remediation?.completed ?? []).filter(
		(row): row is Record<string, unknown> => Boolean(row) && typeof row === "object",
	);
	const blockerRows = (remediation?.resolvedBlockers ?? []).filter(
		(row): row is Record<string, unknown> => Boolean(row) && typeof row === "object",
	);
	const qaRunRows = qaLoop?.lastRun && typeof qaLoop.lastRun === "object" ? [qaLoop.lastRun] : [];

	const summaries: QaReportSummary[] = [
		...sliceRows.map((row) => buildSliceSummary(row)).filter((row): row is QaReportSummary => row !== null),
		...blockerRows.map((row) => buildBlockerSummary(row)).filter((row): row is QaReportSummary => row !== null),
		...qaRunRows.map((row) => buildQaRunSummary(row)).filter((row): row is QaReportSummary => row !== null),
	];

	summaries.sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : a.finishedAt > b.finishedAt ? -1 : 0));

	const updatedAtCandidates = [remediation?.updatedAt, qaLoop?.updatedAt, trends.sourceUpdatedAt].filter(
		(value): value is string => typeof value === "string",
	);
	const lastUpdatedAt =
		updatedAtCandidates.length > 0
			? [...updatedAtCandidates].sort().reverse()[0] ?? null
			: null;

	const counts: Record<QaReportKind, number> = { slice: 0, blocker: 0, qa_run: 0 };
	for (const summary of summaries) {
		counts[summary.kind] += 1;
	}

	return {
		reports: summaries,
		totals: {
			total: summaries.length,
			slices: counts.slice,
			blockers: counts.blocker,
			qaRuns: counts.qa_run,
		},
		lastUpdatedAt,
		trends,
	};
}

export async function getQaReportDetail(id: string): Promise<QaReportDetail | null> {
  if (!id || typeof id !== "string") return null;
  const [kind, sourceRaw] = id.split(":", 2);
  if (!kind || !sourceRaw) return null;
  const [remediation, qaLoop] = await Promise.all([loadRemediationState(), loadQaLoopState()]);

  if (kind === "slice") {
    const target = sourceRaw;
    const rows = (remediation?.completed ?? []).filter(
      (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object",
    );
    const entry = rows.find((row) => coerceString(row.id) === target);
    if (!entry) return null;
    const summary = buildSliceSummary(entry);
    return summary ? buildSliceDetail(summary, entry) : null;
  }

  if (kind === "blocker") {
    const target = sourceRaw;
    const rows = (remediation?.resolvedBlockers ?? []).filter(
      (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object",
    );
    const entry = rows.find((row) => coerceString(row.target) === target);
    if (!entry) return null;
    const summary = buildBlockerSummary(entry);
    return summary ? buildBlockerDetail(summary, entry) : null;
  }

  if (kind === "qa_run") {
    const lastRun = qaLoop?.lastRun;
    if (!lastRun || typeof lastRun !== "object") return null;
    if (coerceString(lastRun.id) !== sourceRaw) return null;
    const summary = buildQaRunSummary(lastRun);
    return summary ? buildQaRunDetail(summary, lastRun) : null;
  }

  return null;
}

export const __testing = {
  hermesPath,
  buildSliceSummary,
  buildBlockerSummary,
  buildQaRunSummary,
};
