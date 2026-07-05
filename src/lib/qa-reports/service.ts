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

import { computeQaReportTrends } from "./trends";
export { computeQaReportTrends } from "./trends";
import type {
	QaReportDetail,
	QaReportEvidenceRow,
	QaReportKind,
	QaReportSummary,
	QaReportsListResult,
} from "./dto";

const HERMES_DIRNAME = ".hermes";
const REMEDIATION_STATE_FILENAME = "remediation-state.json";
const QA_LOOP_STATE_FILENAME = "qa-loop-state.json";

const TRUNCATE_SUMMARY_CHARS = 240;

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
