/**
 * scripts/queue-audit.ts
 *
 * Static analyzer for the cron maintenance task queue at
 * `~/.hermes/state/vcontrolhub-task-queue.json`. Cross-references the
 * queue file with `git log` to surface drift between the two sources
 * of truth, and produces a human + machine readable report.
 *
 * Drift categories emitted (with a stable `code` string):
 *   - `done-missing-commit`           — task.status="done" but commit is null
 *   - `done-commit-not-in-git`        — task.commit hash not present in git log
 *   - `done-completed-before-started` — task.completed_at < started_at (impossible)
 *   - `in_progress-missing-started_at`— in_progress task with no started_at
 *   - `blocked-missing-last_error`    — blocked task with no last_error
 *   - `failed_permanently-missing-error`— failed task with no last_error
 *   - `done_count-mismatch`           — top-level done_count != count(status=done)
 *   - `total-mismatch`                — top-level total != tasks.length
 *   - `pending-stale-started_at`      — pending task with non-null started_at
 *   - `pending-3x-attempts-stuck`     — pending task with attempts >= 3 (soft)
 *   - `orphan-pending-manual_only`    — pending task with manual_only=true (can't
 *                                       be picked up by cron; soft reminder)
 *   - `orphan-blocked-pending-recovery`— blocked task with last_error like
 *                                       "work_committed_pending_user_review" but
 *                                       the commit is not in git log
 *   - `txx-id-sequence-gap`           — T01..T12 series has a hole (soft)
 *   - `commit-msg-missing-tr-tag`     — recent commit (last 50) has no `TR-` or
 *                                       recognized conventional prefix (soft)
 *   - `tr-not-in-queue`               — done task.tr "TR-XXX" is not a known
 *                                       TR identifier; soft informational
 *
 * Output:
 *   - JSON report to `docs/queue-audit.json`
 *   - Markdown report to `docs/queue-audit.md`
 *   - Stdout summary: task count, done count, drift count by code
 *   - Exit code 0 (informational)
 *
 * Run: `npx tsx scripts/queue-audit.ts`
 */
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const QUEUE_PATH = join(
  process.env.HOME ?? "/root",
  ".hermes",
  "state",
  "vcontrolhub-task-queue.json"
);
const REPORT_JSON_PATH = join(ROOT, "docs", "queue-audit.json");
const REPORT_MD_PATH = join(ROOT, "docs", "queue-audit.md");
const GIT_LOG_LIMIT = 50;

// ─── Public types ──────────────────────────────────────────────────────────

export type TaskStatus =
  | "pending"
  | "in_progress"
  | "done"
  | "blocked"
  | "failed_permanently";

export interface QueueTask {
  id: string;
  tr?: string;
  title: string;
  status: TaskStatus;
  attempts: number;
  last_error: string | null;
  commit: string | null;
  started_at: string | null;
  completed_at: string | null;
  manual_only?: boolean;
  estimated?: string;
  notes?: string;
}

export interface QueueFile {
  version: number;
  tasks: QueueTask[];
  done_count: number;
  total: number;
  next_id?: number;
  updated_at?: string;
  updated_by?: string;
  auto_remediation?: { enabled?: boolean; trigger?: string; first_run?: boolean };
  last_completed_at?: string;
  total_tasks?: number;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  subject: string;
}

export type DriftCode =
  | "done-missing-commit"
  | "done-commit-not-in-git"
  | "done-completed-before-started"
  | "in_progress-missing-started_at"
  | "blocked-missing-last_error"
  | "failed_permanently-missing-error"
  | "done_count-mismatch"
  | "total-mismatch"
  | "pending-stale-started_at"
  | "pending-3x-attempts-stuck"
  | "orphan-pending-manual_only"
  | "orphan-blocked-pending-recovery"
  | "txx-id-sequence-gap"
  | "commit-msg-missing-tr-tag"
  | "tr-not-in-queue";

export interface Drift {
  code: DriftCode;
  severity: "error" | "warn" | "info";
  message: string;
  taskId?: string;
  commitHash?: string;
}

export interface AuditReport {
  generatedAt: string;
  queuePath: string;
  summary: {
    total: number;
    done: number;
    pending: number;
    inProgress: number;
    blocked: number;
    failedPermanently: number;
    driftCount: number;
    driftsByCode: Record<string, number>;
  };
  drifts: Drift[];
  topLevelChecks: {
    doneCount: { declared: number; actual: number; ok: boolean };
    total: { declared: number; actual: number; ok: boolean };
  };
  recentCommits: { hash: string; subject: string }[];
}

// ─── Loaders ───────────────────────────────────────────────────────────────

export function loadQueue(filePath: string): QueueFile {
  if (!existsSync(filePath)) {
    throw new Error(`queue file not found at ${filePath}`);
  }
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as QueueFile;
  if (!Array.isArray(parsed.tasks)) {
    throw new Error(`queue file ${filePath} has no tasks[] array`);
  }
  return parsed;
}

export function parseGitLog(stdout: string, limit: number): GitCommit[] {
  // Format produced by `git log --format=%H%x1f%h%x1f%s -N`
  const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
  const out: GitCommit[] = [];
  for (const line of lines) {
    const parts = line.split("\x1f");
    if (parts.length < 3) continue;
    out.push({
      hash: parts[0]!.trim(),
      shortHash: parts[1]!.trim(),
      subject: parts.slice(2).join("\x1f").trim(),
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function loadAllCommitHashes(repoPath: string): Set<string> {
  // Use `git rev-list --all` to enumerate every commit hash (both short and
  // long form) in the repository. The output is small enough to load into
  // a Set for O(1) membership checks. This is the canonical source of
  // truth for "does this commit exist?", and avoids the false-positive
  // window-limit problem of `git log -n N`.
  try {
    const stdout = execFileSync(
      "git",
      ["-C", repoPath, "rev-list", "--all"],
      {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        // Suppress "fatal: not a git repository" stderr when called against
        // a non-git path (e.g. test temp dir); we just want an empty Set.
        stdio: ["ignore", "pipe", "ignore"],
      }
    );
    const out = new Set<string>();
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      out.add(trimmed);
      out.add(trimmed.slice(0, 7));
    }
    return out;
  } catch {
    return new Set();
  }
}

export function loadRecentCommits(
  repoPath: string,
  limit: number = GIT_LOG_LIMIT
): GitCommit[] {
  try {
    const stdout = execFileSync(
      "git",
      [
        "-C",
        repoPath,
        "log",
        `--format=%H%x1f%h%x1f%s`,
        "-n",
        String(limit),
      ],
      {
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      }
    );
    return parseGitLog(stdout, limit);
  } catch {
    return [];
  }
}

// ─── Audit core ────────────────────────────────────────────────────────────

const TXX_PATTERN = /^T(\d{1,3})$/;

function findTxxGaps(tasks: QueueTask[]): number[] {
  // Collect Txx indices (T01..T99) and report missing integers in 1..max.
  const indices = new Set<number>();
  for (const t of tasks) {
    const m = TXX_PATTERN.exec(t.id);
    if (m) {
      const n = Number.parseInt(m[1]!, 10);
      if (Number.isFinite(n) && n >= 1 && n <= 99) {
        indices.add(n);
      }
    }
  }
  if (indices.size === 0) return [];
  let max = 0;
  for (const n of Array.from(indices)) if (n > max) max = n;
  const gaps: number[] = [];
  for (let n = 1; n <= max; n += 1) {
    if (!indices.has(n)) gaps.push(n);
  }
  return gaps;
}

const KNOWN_TR_PREFIX = /^(TR-\d{1,3}|New-[A-Z]\d*|cron-prompt|TR-\d{1,3}[a-z]?|lint)$/;

function commitMessageLooksStructured(subject: string): boolean {
  // Conventional commit / known prefixes: "feat(...)", "refactor(...)",
  // "fix(...)", "docs(...)", "chore(...)", "test(...)", or any subject that
  // already contains a "TR-XXX" tag anywhere in the message.
  const conventional = /^(feat|fix|refactor|docs|chore|test|perf|build|ci|style|revert)\s*(\([^)]+\))?\s*:/;
  if (conventional.test(subject)) return true;
  if (/\bTR-\d{1,3}\b/.test(subject)) return true;
  // Accept "docs(readme): ..." style without conventional prefix
  if (/^[a-z][a-z0-9-]*\s*\(/.test(subject) && /:/.test(subject)) return true;
  return false;
}

export function auditQueue(
  queue: QueueFile,
  commits: GitCommit[],
  commitHashes: Set<string> = new Set(commits.map((c) => c.hash).concat(commits.map((c) => c.shortHash)))
): AuditReport {
  const drifts: Drift[] = [];
  const trInQueue = new Set<string>();
  for (const t of queue.tasks) {
    if (t.tr) trInQueue.add(t.tr);
  }

  // Per-task checks
  for (const t of queue.tasks) {
    if (t.status === "done") {
      if (!t.commit) {
        drifts.push({
          code: "done-missing-commit",
          severity: "error",
          taskId: t.id,
          message: `task ${t.id} status=done but commit field is null`,
        });
      } else if (!commitHashes.has(t.commit)) {
        drifts.push({
          code: "done-commit-not-in-git",
          severity: "error",
          taskId: t.id,
          commitHash: t.commit,
          message: `task ${t.id} commit ${t.commit} not found in last ${commits.length} git commits`,
        });
      }
      if (t.started_at && t.completed_at) {
        const started = Date.parse(t.started_at);
        const completed = Date.parse(t.completed_at);
        if (
          Number.isFinite(started) &&
          Number.isFinite(completed) &&
          completed < started
        ) {
          drifts.push({
            code: "done-completed-before-started",
            severity: "error",
            taskId: t.id,
            message: `task ${t.id} completed_at (${t.completed_at}) is before started_at (${t.started_at})`,
          });
        }
      }
    } else if (t.status === "in_progress") {
      if (!t.started_at) {
        drifts.push({
          code: "in_progress-missing-started_at",
          severity: "error",
          taskId: t.id,
          message: `task ${t.id} status=in_progress but started_at is null`,
        });
      }
    } else if (t.status === "blocked") {
      if (!t.last_error) {
        drifts.push({
          code: "blocked-missing-last_error",
          severity: "warn",
          taskId: t.id,
          message: `task ${t.id} status=blocked but last_error is null (reviewer has no context)`,
        });
      } else if (
        t.last_error.includes("work_committed_pending_user_review") &&
        t.commit &&
        !commitHashes.has(t.commit)
      ) {
        drifts.push({
          code: "orphan-blocked-pending-recovery",
          severity: "warn",
          taskId: t.id,
          commitHash: t.commit,
          message: `task ${t.id} marked work_committed_pending_user_review but commit ${t.commit} not in git log; commit may have been reverted or never pushed`,
        });
      }
    } else if (t.status === "failed_permanently") {
      if (!t.last_error) {
        drifts.push({
          code: "failed_permanently-missing-error",
          severity: "warn",
          taskId: t.id,
          message: `task ${t.id} status=failed_permanently but last_error is null (operators have no context)`,
        });
      }
    } else if (t.status === "pending") {
      if (t.started_at) {
        drifts.push({
          code: "pending-stale-started_at",
          severity: "warn",
          taskId: t.id,
          message: `task ${t.id} status=pending but started_at (${t.started_at}) is non-null (likely left over from a prior in_progress tick)`,
        });
      }
      if ((t.attempts ?? 0) >= 3) {
        drifts.push({
          code: "pending-3x-attempts-stuck",
          severity: "warn",
          taskId: t.id,
          message: `task ${t.id} attempts=${t.attempts} (>=3) and still pending; cron spec says it should be marked failed_permanently`,
        });
      }
      if (t.manual_only) {
        drifts.push({
          code: "orphan-pending-manual_only",
          severity: "info",
          taskId: t.id,
          message: `task ${t.id} is pending + manual_only; cron ticks will skip this (correct, soft reminder only)`,
        });
      }
    }
    if (t.tr && !KNOWN_TR_PREFIX.test(t.tr)) {
      drifts.push({
        code: "tr-not-in-queue",
        severity: "info",
        taskId: t.id,
        message: `task ${t.id} has unknown tr tag "${t.tr}" (informational; not all tasks fit a TR bucket)`,
      });
    }
  }

  // Top-level consistency
  const actualDone = queue.tasks.filter((t) => t.status === "done").length;
  if (queue.done_count !== actualDone) {
    drifts.push({
      code: "done_count-mismatch",
      severity: "error",
      message: `top-level done_count=${queue.done_count} but actual count of tasks[].status="done" is ${actualDone}`,
    });
  }
  const actualTotal = queue.tasks.length;
  const declaredTotal: number =
    typeof queue.total_tasks === "number"
      ? queue.total_tasks
      : queue.total;
  if (declaredTotal !== actualTotal) {
    drifts.push({
      code: "total-mismatch",
      severity: "error",
      message: `top-level total${queue.total_tasks != null ? "_tasks" : ""}=${declaredTotal} but tasks.length is ${actualTotal}`,
    });
  }

  // TXX id sequence gaps (soft)
  const txxGaps = findTxxGaps(queue.tasks);
  for (const missing of txxGaps) {
    drifts.push({
      code: "txx-id-sequence-gap",
      severity: "info",
      message: `T${String(missing).padStart(2, "0")} not present in queue (sequence gap; soft informational)`,
    });
  }

  // Recent commit message format (soft)
  for (const commit of commits) {
    if (!commitMessageLooksStructured(commit.subject)) {
      drifts.push({
        code: "commit-msg-missing-tr-tag",
        severity: "info",
        commitHash: commit.shortHash,
        message: `commit ${commit.shortHash} subject "${truncate(commit.subject, 80)}" lacks a recognized conventional prefix or TR- tag`,
      });
    }
  }

  // Summary
  const summary = {
    total: queue.tasks.length,
    done: actualDone,
    pending: queue.tasks.filter((t) => t.status === "pending").length,
    inProgress: queue.tasks.filter((t) => t.status === "in_progress").length,
    blocked: queue.tasks.filter((t) => t.status === "blocked").length,
    failedPermanently: queue.tasks.filter(
      (t) => t.status === "failed_permanently"
    ).length,
    driftCount: drifts.length,
    driftsByCode: drifts.reduce<Record<string, number>>((acc, d) => {
      acc[d.code] = (acc[d.code] ?? 0) + 1;
      return acc;
    }, {}),
  };

  return {
    generatedAt: new Date().toISOString(),
    queuePath: QUEUE_PATH,
    summary,
    drifts,
    topLevelChecks: {
      doneCount: {
        declared: queue.done_count,
        actual: actualDone,
        ok: queue.done_count === actualDone,
      },
      total: {
        declared: declaredTotal,
        actual: actualTotal,
        ok: declaredTotal === actualTotal,
      },
    },
    recentCommits: commits.map((c) => ({
      hash: c.shortHash,
      subject: c.subject,
    })),
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ─── Markdown rendering ────────────────────────────────────────────────────

export function buildMarkdown(report: AuditReport): string {
  const driftRows = report.drifts
    .map(
      (d) =>
        `| \`${d.code}\` | ${d.severity} | ${d.taskId ?? "—"} | ${
          d.commitHash ?? "—"
        } | ${escapePipe(d.message)} |`
    )
    .join("\n");

  const driftsByCodeLines = Object.entries(report.summary.driftsByCode)
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => `| \`${code}\` | ${count} |`)
    .join("\n");

  const commitRows = report.recentCommits
    .slice(0, 10)
    .map((c) => `| \`${c.hash}\` | ${escapePipe(c.subject)} |`)
    .join("\n");

  return `# VControlHub Cron Queue Audit

Generated: ${report.generatedAt}
Source: \`${report.queuePath}\`

## Summary

| Metric | Value |
| --- | --- |
| Total tasks | ${report.summary.total} |
| done | ${report.summary.done} |
| pending | ${report.summary.pending} |
| in_progress | ${report.summary.inProgress} |
| blocked | ${report.summary.blocked} |
| failed_permanently | ${report.summary.failedPermanently} |
| Drift count | ${report.summary.driftCount} |

## Top-level checks

| Check | Declared | Actual | OK |
| --- | --- | --- | --- |
| done_count | ${report.topLevelChecks.doneCount.declared} | ${report.topLevelChecks.doneCount.actual} | ${
    report.topLevelChecks.doneCount.ok ? "✅" : "❌"
  } |
| total${report.topLevelChecks.total.declared === report.summary.total ? "" : " (total_tasks)"} | ${
    report.topLevelChecks.total.declared
  } | ${report.topLevelChecks.total.actual} | ${
    report.topLevelChecks.total.ok ? "✅" : "❌"
  } |

## Drifts

${
  report.drifts.length === 0
    ? "_No drifts detected._"
    : `| code | severity | task | commit | message |
| --- | --- | --- | --- | --- |
${driftRows}`
}

## Drifts by code

${
  driftsByCodeLines
    ? `| code | count |
| --- | --- |
${driftsByCodeLines}`
    : "_none_"
}

## Recent commits (last 10 of ${report.recentCommits.length} sampled)

| hash | subject |
| --- | --- |
${commitRows}

## Notes

- This is an **informational** audit. It does not modify the queue file or
  run any code paths; it produces a report and exits 0.
- **error** drifts are hard inconsistencies that should be reconciled
  before the next cron tick (e.g. \`done-missing-commit\`, \`done_count-mismatch\`).
- **warn** drifts are operationally important but not blocking
  (e.g. \`blocked-missing-last_error\`, \`pending-3x-attempts-stuck\`).
- **info** drifts are soft signals (e.g. sequence gaps, manual-only
  reminders, conventional-commit advisories).
`;
}

function escapePipe(s: string): string {
  return s.replace(/\|/g, "\\|");
}

// ─── Main entry point ──────────────────────────────────────────────────────

function main(): void {
  const queue = loadQueue(QUEUE_PATH);
  const commits = loadRecentCommits(ROOT, GIT_LOG_LIMIT);
  const commitHashes = loadAllCommitHashes(ROOT);
  const report = auditQueue(queue, commits, commitHashes);

  mkdirSync(dirname(REPORT_JSON_PATH), { recursive: true });
  mkdirSync(dirname(REPORT_MD_PATH), { recursive: true });
  writeFileSync(REPORT_JSON_PATH, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(REPORT_MD_PATH, buildMarkdown(report));

  // Stdout summary
  process.stdout.write(`queue-audit: ${report.summary.driftCount} drift(s)\n`);
  for (const [code, count] of Object.entries(
    report.summary.driftsByCode
  ).sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${code}: ${count}\n`);
  }
  process.stdout.write(
    `report: ${REPORT_JSON_PATH} + ${REPORT_MD_PATH}\n`
  );
}

// Run when invoked directly (not when imported by tests).
const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("queue-audit.ts") ||
    process.argv[1].endsWith("queue-audit"));
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `queue-audit: error: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(2);
  }
}
