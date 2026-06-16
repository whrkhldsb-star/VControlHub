/**
 * scripts/__tests__/queue-audit.test.ts
 *
 * Unit tests for the queue-audit cross-reference analyzer. The audit's
 * job is to detect drift between the cron task queue file and the git
 * repository state. These tests cover the pure-function exports.
 */
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadQueue,
  parseGitLog,
  loadAllCommitHashes,
  auditQueue,
  buildMarkdown,
  type QueueFile,
  type GitCommit,
  type AuditReport,
} from "../queue-audit";

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeQueue(overrides?: Partial<QueueFile>): QueueFile {
  return {
    version: 1,
    tasks: [],
    done_count: 0,
    total: 0,
    ...overrides,
  };
}

function makeTask(overrides: Partial<QueueFile["tasks"][number]>): QueueFile["tasks"][number] {
  return {
    id: "T01",
    title: "test task",
    status: "pending",
    attempts: 0,
    last_error: null,
    commit: null,
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

let tempDir: string | null = null;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "queue-audit-test-"));
});

afterEach(() => {
  if (tempDir) {
    // Best-effort cleanup; tmp dir is small.
    try {
      const { rmSync } = require("node:fs") as typeof import("node:fs");
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    tempDir = null;
  }
});

function writeQueueFile(content: QueueFile): string {
  if (!tempDir) throw new Error("tempDir not initialized");
  const path = join(tempDir, "queue.json");
  writeFileSync(path, JSON.stringify(content, null, 2));
  return path;
}

// ─── parseGitLog ──────────────────────────────────────────────────────────

describe("parseGitLog", () => {
  it("parses the %H%x1f%h%x1f%s format with one commit per line", () => {
    const stdout =
      "abc1234567890abcdef1234567890abcdef123456\x1fabc1234\x1ffeat: add foo\n" +
      "def4567890abcdef1234567890abcdef12345678\x1fdef4567\x1ffix: handle bar";
    const commits = parseGitLog(stdout, 50);
    expect(commits).toEqual([
      { hash: "abc1234567890abcdef1234567890abcdef123456", shortHash: "abc1234", subject: "feat: add foo" },
      { hash: "def4567890abcdef1234567890abcdef12345678", shortHash: "def4567", subject: "fix: handle bar" },
    ]);
  });

  it("respects the limit parameter", () => {
    const stdout =
      "aaa\x1faaa\x1fs1\nbbb\x1fbbb\x1fs2\nccc\x1fccc\x1fs3\n";
    expect(parseGitLog(stdout, 2)).toHaveLength(2);
    expect(parseGitLog(stdout, 10)).toHaveLength(3);
  });

  it("ignores empty lines", () => {
    const stdout = "\n\nabc\x1fabc\x1ffeat: x\n\n";
    const commits = parseGitLog(stdout, 50);
    expect(commits).toHaveLength(1);
    expect(commits[0]?.subject).toBe("feat: x");
  });
});

// ─── loadQueue ────────────────────────────────────────────────────────────

describe("loadQueue", () => {
  it("loads a well-formed queue file and exposes its fields", () => {
    const queue = makeQueue({
      tasks: [makeTask({ id: "T01", status: "pending" })],
      done_count: 0,
      total: 1,
    });
    const path = writeQueueFile(queue);
    const loaded = loadQueue(path);
    expect(loaded.tasks).toHaveLength(1);
    expect(loaded.tasks[0]?.id).toBe("T01");
    expect(loaded.total).toBe(1);
  });

  it("throws when the file does not exist", () => {
    expect(() => loadQueue("/nonexistent/path/queue.json")).toThrow(
      /queue file not found/
    );
  });

  it("throws when the file is not a queue document", () => {
    if (!tempDir) throw new Error("tempDir not initialized");
    const path = join(tempDir, "bad.json");
    writeFileSync(path, JSON.stringify({ foo: "bar" }));
    expect(() => loadQueue(path)).toThrow(/has no tasks\[\] array/);
  });
});

// ─── loadAllCommitHashes ──────────────────────────────────────────────────

describe("loadAllCommitHashes", () => {
  it("returns an empty set when git rev-list fails (e.g. non-git path)", () => {
    if (!tempDir) throw new Error("tempDir not initialized");
    const out = loadAllCommitHashes(tempDir);
    expect(out.size).toBe(0);
  });
});

// ─── auditQueue — done task checks ───────────────────────────────────────

describe("auditQueue — done task drift", () => {
  const commits: GitCommit[] = [
    { hash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", shortHash: "a1b2c3d", subject: "feat: foo" },
  ];
  const commitHashes = new Set([
    "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    "a1b2c3d",
  ]);

  it("flags done-missing-commit when commit is null", () => {
    const q = makeQueue({
      tasks: [makeTask({ id: "T01", status: "done", commit: null })],
      done_count: 1,
      total: 1,
    });
    const report = auditQueue(q, commits, commitHashes);
    const drift = report.drifts.find((d) => d.code === "done-missing-commit");
    expect(drift).toBeDefined();
    expect(drift?.taskId).toBe("T01");
    expect(drift?.severity).toBe("error");
  });

  it("flags done-commit-not-in-git when commit is not in the hash set", () => {
    const q = makeQueue({
      tasks: [makeTask({ id: "T01", status: "done", commit: "deadbeef" })],
      done_count: 1,
      total: 1,
    });
    const report = auditQueue(q, commits, commitHashes);
    const drift = report.drifts.find((d) => d.code === "done-commit-not-in-git");
    expect(drift).toBeDefined();
    expect(drift?.taskId).toBe("T01");
    expect(drift?.commitHash).toBe("deadbeef");
  });

  it("accepts done task with matching commit (long or short form)", () => {
    const q = makeQueue({
      tasks: [
        makeTask({
          id: "T01",
          status: "done",
          commit: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        }),
        makeTask({ id: "T02", status: "done", commit: "a1b2c3d" }),
      ],
      done_count: 2,
      total: 2,
    });
    const report = auditQueue(q, commits, commitHashes);
    expect(
      report.drifts.find((d) => d.code === "done-missing-commit")
    ).toBeUndefined();
    expect(
      report.drifts.find((d) => d.code === "done-commit-not-in-git")
    ).toBeUndefined();
  });

  it("flags done-completed-before-started when timestamps are inverted", () => {
    const q = makeQueue({
      tasks: [
        makeTask({
          id: "T01",
          status: "done",
          commit: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
          started_at: "2026-06-16T01:00:00Z",
          completed_at: "2026-06-16T00:00:00Z",
        }),
      ],
      done_count: 1,
      total: 1,
    });
    const report = auditQueue(q, commits, commitHashes);
    const drift = report.drifts.find(
      (d) => d.code === "done-completed-before-started"
    );
    expect(drift).toBeDefined();
    expect(drift?.severity).toBe("error");
  });
});

// ─── auditQueue — in_progress / blocked / failed / pending checks ─────────

describe("auditQueue — non-done task drift", () => {
  const emptyCommits: GitCommit[] = [];
  const emptyHashes = new Set<string>();

  it("flags in_progress-missing-started_at when started_at is null", () => {
    const q = makeQueue({
      tasks: [makeTask({ id: "T01", status: "in_progress", started_at: null })],
      done_count: 0,
      total: 1,
    });
    const report = auditQueue(q, emptyCommits, emptyHashes);
    const drift = report.drifts.find(
      (d) => d.code === "in_progress-missing-started_at"
    );
    expect(drift).toBeDefined();
    expect(drift?.severity).toBe("error");
  });

  it("flags blocked-missing-last_error when last_error is null", () => {
    const q = makeQueue({
      tasks: [makeTask({ id: "T01", status: "blocked", last_error: null })],
      done_count: 0,
      total: 1,
    });
    const report = auditQueue(q, emptyCommits, emptyHashes);
    const drift = report.drifts.find(
      (d) => d.code === "blocked-missing-last_error"
    );
    expect(drift).toBeDefined();
    expect(drift?.severity).toBe("warn");
  });

  it("flags failed_permanently-missing-error when last_error is null", () => {
    const q = makeQueue({
      tasks: [makeTask({ id: "T01", status: "failed_permanently", last_error: null })],
      done_count: 0,
      total: 1,
    });
    const report = auditQueue(q, emptyCommits, emptyHashes);
    const drift = report.drifts.find(
      (d) => d.code === "failed_permanently-missing-error"
    );
    expect(drift).toBeDefined();
  });

  it("flags pending-stale-started_at when a pending task has started_at", () => {
    const q = makeQueue({
      tasks: [
        makeTask({
          id: "T01",
          status: "pending",
          started_at: "2026-06-16T01:00:00Z",
        }),
      ],
      done_count: 0,
      total: 1,
    });
    const report = auditQueue(q, emptyCommits, emptyHashes);
    const drift = report.drifts.find(
      (d) => d.code === "pending-stale-started_at"
    );
    expect(drift).toBeDefined();
  });

  it("flags pending-3x-attempts-stuck when attempts >= 3", () => {
    const q = makeQueue({
      tasks: [makeTask({ id: "T01", status: "pending", attempts: 4 })],
      done_count: 0,
      total: 1,
    });
    const report = auditQueue(q, emptyCommits, emptyHashes);
    const drift = report.drifts.find(
      (d) => d.code === "pending-3x-attempts-stuck"
    );
    expect(drift).toBeDefined();
    expect(drift?.severity).toBe("warn");
  });

  it("flags orphan-pending-manual_only with info severity", () => {
    const q = makeQueue({
      tasks: [makeTask({ id: "M01", status: "pending", manual_only: true })],
      done_count: 0,
      total: 1,
    });
    const report = auditQueue(q, emptyCommits, emptyHashes);
    const drift = report.drifts.find(
      (d) => d.code === "orphan-pending-manual_only"
    );
    expect(drift).toBeDefined();
    expect(drift?.severity).toBe("info");
  });
});

// ─── auditQueue — top-level checks ────────────────────────────────────────

describe("auditQueue — top-level consistency", () => {
  const emptyCommits: GitCommit[] = [];
  const emptyHashes = new Set<string>();

  it("flags done_count-mismatch when declared != actual", () => {
    const q = makeQueue({
      tasks: [
        makeTask({ id: "T01", status: "done", commit: "a1" }),
        makeTask({ id: "T02", status: "done", commit: "a2" }),
      ],
      done_count: 5, // wrong
      total: 2,
    });
    const report = auditQueue(q, emptyCommits, emptyHashes);
    const drift = report.drifts.find(
      (d) => d.code === "done_count-mismatch"
    );
    expect(drift).toBeDefined();
    expect(drift?.message).toMatch(/done_count=5/);
  });

  it("flags total-mismatch when declared != tasks.length", () => {
    const q = makeQueue({
      tasks: [makeTask({ id: "T01", status: "pending" })],
      done_count: 0,
      total: 99, // wrong
    });
    const report = auditQueue(q, emptyCommits, emptyHashes);
    const drift = report.drifts.find((d) => d.code === "total-mismatch");
    expect(drift).toBeDefined();
  });

  it("prefers total_tasks over total when both are present", () => {
    const q = makeQueue({
      tasks: [makeTask({ id: "T01", status: "pending" })],
      done_count: 0,
      total: 99,
      total_tasks: 1,
    });
    const report = auditQueue(q, emptyCommits, emptyHashes);
    const totalCheck = report.topLevelChecks.total;
    expect(totalCheck.declared).toBe(1);
    expect(totalCheck.actual).toBe(1);
    expect(totalCheck.ok).toBe(true);
  });

  it("passes when done_count and total match actual values", () => {
    const q = makeQueue({
      tasks: [
        makeTask({ id: "T01", status: "done", commit: "a" }),
        makeTask({ id: "T02", status: "pending" }),
      ],
      done_count: 1,
      total: 2,
    });
    const report = auditQueue(q, emptyCommits, emptyHashes);
    expect(report.topLevelChecks.doneCount.ok).toBe(true);
    expect(report.topLevelChecks.total.ok).toBe(true);
    expect(
      report.drifts.find((d) => d.code === "done_count-mismatch")
    ).toBeUndefined();
    expect(
      report.drifts.find((d) => d.code === "total-mismatch")
    ).toBeUndefined();
  });
});

// ─── auditQueue — TXX sequence gaps ───────────────────────────────────────

describe("auditQueue — TXX sequence gaps", () => {
  const emptyCommits: GitCommit[] = [];
  const emptyHashes = new Set<string>();

  it("reports each missing T-index in the T01..Tnn range", () => {
    const q = makeQueue({
      tasks: [
        makeTask({ id: "T01", status: "done", commit: "a" }),
        makeTask({ id: "T03", status: "done", commit: "b" }),
        makeTask({ id: "T05", status: "done", commit: "c" }),
      ],
      done_count: 3,
      total: 3,
    });
    const report = auditQueue(q, emptyCommits, emptyHashes);
    const gaps = report.drifts
      .filter((d) => d.code === "txx-id-sequence-gap")
      .map((d) => d.message);
    expect(gaps).toEqual(
      expect.arrayContaining([
        expect.stringContaining("T02"),
        expect.stringContaining("T04"),
      ])
    );
  });

  it("ignores Tnn suffix ids like T17a / T34b1 from the gap check", () => {
    const q = makeQueue({
      tasks: [
        makeTask({ id: "T01", status: "done", commit: "a" }),
        makeTask({ id: "T17a", status: "done", commit: "b" }),
      ],
      done_count: 2,
      total: 2,
    });
    const report = auditQueue(q, emptyCommits, emptyHashes);
    const gaps = report.drifts.filter(
      (d) => d.code === "txx-id-sequence-gap"
    );
    // T17a is not a plain Txx id; T02..T16 all missing, so expect many gaps
    // but NOT specifically a gap at T17.
    const t17Gap = gaps.find((g) => g.message.includes("T17"));
    expect(t17Gap).toBeUndefined();
  });
});

// ─── buildMarkdown ────────────────────────────────────────────────────────

describe("buildMarkdown", () => {
  it("produces a header, summary, top-level checks, drifts table", () => {
    const report: AuditReport = {
      generatedAt: "2026-06-16T10:00:00.000Z",
      queuePath: "/tmp/queue.json",
      summary: {
        total: 5,
        done: 3,
        pending: 1,
        inProgress: 0,
        blocked: 1,
        failedPermanently: 0,
        driftCount: 2,
        driftsByCode: {
          "done-missing-commit": 1,
          "blocked-missing-last_error": 1,
        },
      },
      drifts: [
        {
          code: "done-missing-commit",
          severity: "error",
          taskId: "T05",
          message: "task T05 status=done but commit field is null",
        },
        {
          code: "blocked-missing-last_error",
          severity: "warn",
          taskId: "M02",
          message: "task M02 status=blocked but last_error is null",
        },
      ],
      topLevelChecks: {
        doneCount: { declared: 3, actual: 3, ok: true },
        total: { declared: 5, actual: 5, ok: true },
      },
      recentCommits: [
        { hash: "abc1234", subject: "feat: foo" },
      ],
    };
    const md = buildMarkdown(report);
    expect(md).toContain("# VControlHub Cron Queue Audit");
    expect(md).toContain("Total tasks | 5");
    expect(md).toContain("done_count | 3 | 3 | ✅");
    expect(md).toContain("`done-missing-commit`");
    expect(md).toContain("M02");
    expect(md).toContain("`abc1234`");
  });

  it("renders the no-drifts note when the queue is clean", () => {
    const report: AuditReport = {
      generatedAt: "2026-06-16T10:00:00.000Z",
      queuePath: "/tmp/queue.json",
      summary: {
        total: 0,
        done: 0,
        pending: 0,
        inProgress: 0,
        blocked: 0,
        failedPermanently: 0,
        driftCount: 0,
        driftsByCode: {},
      },
      drifts: [],
      topLevelChecks: {
        doneCount: { declared: 0, actual: 0, ok: true },
        total: { declared: 0, actual: 0, ok: true },
      },
      recentCommits: [],
    };
    const md = buildMarkdown(report);
    expect(md).toContain("_No drifts detected._");
  });
});

// ─── Integration smoke test (only runs if real queue + git are present) ───

describe("integration smoke test", () => {
  it("produces a report when the real queue + git are accessible", () => {
    const realQueuePath = join(
      process.env.HOME ?? "/root",
      ".hermes",
      "state",
      "vcontrolhub-task-queue.json"
    );
    if (!existsSync(realQueuePath)) return;
    const realRepoPath = process.cwd();
    if (!existsSync(join(realRepoPath, ".git"))) return;
    const queue = loadQueue(realQueuePath);
    const hashes = loadAllCommitHashes(realRepoPath);
    const commits: GitCommit[] = [];
    const report = auditQueue(queue, commits, hashes);
    expect(report.summary.total).toBe(queue.tasks.length);
    expect(report.summary.driftCount).toBeGreaterThanOrEqual(0);
    const md = buildMarkdown(report);
    expect(md.length).toBeGreaterThan(200);
  });
});
