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
};
