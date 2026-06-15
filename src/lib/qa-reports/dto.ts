/**
 * TR-029: shared DTOs for the `/qa-reports` admin page and its companion
 * `/api/admin/qa-reports` API.
 *
 * The list is assembled from three structured sources inside
 * `.hermes/` on the application host:
 *
 *   1. `.hermes/remediation-state.json#completed[]` — every closed QA
 *      slice produced by the maintenance loop. Each entry has
 *      `{ id, completedAt, summary, evidence: { command, result }[] }`.
 *   2. `.hermes/remediation-state.json#resolvedBlockers[]` — every
 *      resolved environment / approval blocker with
 *      `{ target, type, summary, at, resolvedAt, resolution, next }`.
 *   3. `.hermes/qa-loop-state.json#lastRun` — the most recent QA loop
 *      run with the full `evidenceMatrix` and `changeContract`.
 *
 * The shape is normalised into a single `QaReportSummary` row for the
 * list page and a richer `QaReportDetail` (with all evidence rows) for
 * the detail page. Both shapes are returned as JSON and rendered by
 * the matching server / client components under `app/qa-reports/`.
 */

export type QaReportKind = "slice" | "blocker" | "qa_run";

export type QaReportSummary = {
  /** Stable identifier: source-prefixed so the same value space is
   *  usable for `next/link` hrefs. */
  id: string;
  kind: QaReportKind;
  title: string;
  /** Wall-clock time the report happened. ISO-8601, UTC. */
  finishedAt: string;
  /** Optional run counter / sequence number, used for sorting hints
   *  in the list view. */
  sequence?: number;
  /** Status the loop recorded for this row. Free-form so different
   *  sources can keep their own vocabulary. */
  status: string;
  /** Short (≤ 200 char) summary safe to render in the list. */
  summary: string;
  /** Number of evidence rows attached to this report. */
  evidenceCount: number;
};

export type QaReportEvidenceRow = {
  /** Free-form command / probe string. May include backticks. */
  command: string;
  /** Free-form result string. */
  result: string;
};

export type QaReportDetail = QaReportSummary & {
  /** The originating source id (slice id / blocker target / qa run id)
   *  so the detail page can show the provenance footer. */
  sourceId: string;
  /** Optional secondary timestamp (e.g. `at` vs `resolvedAt`). */
  startedAt?: string;
  /** Free-form structured evidence rows for the detail view. */
  evidence: QaReportEvidenceRow[];
  /** Optional `changeContract` straight from `qa-loop-state.json` so
   *  the detail page can link to the commit / files changed. */
  changeContract?: {
    files?: string[];
    commit?: string;
    notes?: string;
  };
  /** Optional resolution hint (blockers) so the operator knows the
   *  follow-up action that was scheduled. */
  next?: string;
  /** Optional free-form supplemental payload the loop left behind. */
  raw?: Record<string, unknown>;
};

export type QaReportsListResult = {
	reports: QaReportSummary[];
	/** Aggregate counts surfaced on the list page header. */
	totals: {
		total: number;
		slices: number;
		blockers: number;
		qaRuns: number;
	};
	/** Most recent `updatedAt` across the underlying state files. */
	lastUpdatedAt: string | null;
	/**
	 * Trend card payload derived from
	 * `.hermes/autonomous-maintenance-state.json#completed_runs[]`. The
	 * shape is always present (it degrades to an empty/zero aggregate
	 * when the source file is missing or malformed) so consumers can
	 * rely on the field existing.
	 */
	trends: QaReportTrends;
};

/** Tones the trend UI can render. Mapped to colour tokens in
 *  `qa-reports-list-client.tsx`. */
export type QaReportTrendTone = "success" | "warn" | "neutral" | "info";

/** One headline number on the trend strip. */
export type QaReportTrendCard = {
	/** Stable id used as React key + aria-labelledby target. */
	id: "totalRuns" | "successRate" | "moduleCoverage" | "lastFailure";
	/** Short label shown above the value. */
	label: string;
	/** Headline value, pre-formatted for display (e.g. "75%"). */
	value: string;
	/** Numeric raw value (used for tests and sort/aria). */
	raw: number;
	/** Tells the UI which colour tone to apply. */
	tone: QaReportTrendTone;
	/** Optional short caption rendered below the value. */
	caption?: string;
};

/** One bucket of `completed_runs` aggregated per UTC day. */
export type QaReportTrendDailyBucket = {
	/** UTC day key, `YYYY-MM-DD`. */
	day: string;
	total: number;
	success: number;
	failed: number;
};

/** Module coverage row showing which of the configured modules have
 *  been touched recently. */
export type QaReportTrendModuleRow = {
	module: string;
	lastVisitedAt: string | null;
	visitCount: number;
};

/** Compact summary of one historical `completed_runs` entry, used in
 *  the "最近 5 次" mini-list on the trend card section. */
export type QaReportTrendRecentRun = {
	timestamp: string;
	module: string;
	result: string;
	isSuccess: boolean;
	summary: string;
};

/** Aggregate trend payload. `null` sub-fields are intentional — they
 *  signal "no data" rather than a missing field. */
export type QaReportTrends = {
	/** Most recent 4 headline cards rendered at the top of the page. */
	cards: QaReportTrendCard[];
	/** Last 7 UTC days, ordered oldest → newest. */
	dailyBuckets: QaReportTrendDailyBucket[];
	/** Module coverage, ordered by `visitCount` desc. */
	moduleCoverage: QaReportTrendModuleRow[];
	/** Last 5 runs, ordered newest first. */
	recentRuns: QaReportTrendRecentRun[];
	/** Most recent failed run summary, or `null` if the last N runs
	 *  all succeeded. */
	lastFailure: {
		timestamp: string;
		module: string;
		summary: string;
	} | null;
	/** Source file's `updatedAt` if present, else `null`. */
	sourceUpdatedAt: string | null;
};
