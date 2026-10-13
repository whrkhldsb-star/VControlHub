import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Two restores of DIFFERENT backups target the same database and file tree, so
 * only one may reach the destructive phase. Uses the real PostgreSQL advisory
 * locks (RUN_DATABASE_INTEGRATION_TESTS=1). Artifacts are real files with real
 * checksums; only the restore scripts themselves are stubbed so the first
 * restore can be held inside its destructive step.
 */
const hasDatabase = process.env.RUN_DATABASE_INTEGRATION_TESTS === "1" && Boolean(process.env.DATABASE_URL);

const state = vi.hoisted(() => ({
  records: new Map<string, Record<string, unknown>>(),
  restoreStarts: [] as string[],
  releaseFirstRestore: null as null | (() => void),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    backupRecord: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.records.get(where.id) ?? null),
      create: vi.fn(async () => ({ id: `snapshot-${state.restoreStarts.length}` })),
    },
    // Restore drain: no other background work is running.
    job: { findMany: vi.fn(async () => []) },
    syncJob: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/backup/command-runner", async () => {
  const { writeFileSync: write } = await import("node:fs");
  return {
    isMissingBackupBinaryError: () => false,
    backupCommandErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    runBackupCommand: vi.fn(async ({ args, options }: { args: string[]; options?: { env?: Record<string, string> } }) => {
      if (options?.env?.CONFIRM_RESTORE !== "1") {
        // Pre-restore safety snapshot: produce the artifact the runtime checks.
        write(args.at(-1)!, "x".repeat(64));
        return;
      }
      state.restoreStarts.push(args.join(" "));
      if (state.restoreStarts.length === 1) {
        await new Promise<void>((resolve) => { state.releaseFirstRestore = resolve; });
      }
    }),
  };
});

const { restoreBackupRecord } = await import("../service-runtime");
const { closeAdvisoryLockPoolForTests } = await import("@/lib/concurrency/advisory-lock");

describe.skipIf(!hasDatabase)("platform restore mutex (PostgreSQL advisory lock)", () => {
  let root: string;
  const previousBackupDir = process.env.BACKUP_DIR;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "vch-restore-mutex-"));
    process.env.BACKUP_DIR = root;
    mkdirSync(join(root, "backups"));
    for (const id of ["backup-a", "backup-b"]) {
      const filePath = `backups/${id}.sql.gz`;
      const content = `-- ${id}\n`;
      writeFileSync(join(root, filePath), content);
      state.records.set(id, {
        id,
        type: "DATABASE",
        status: "COMPLETED",
        filePath,
        checksumSha256: createHash("sha256").update(content).digest("hex"),
        teamId: null,
      });
    }
  });

  afterAll(async () => {
    process.env.BACKUP_DIR = previousBackupDir;
    rmSync(root, { recursive: true, force: true });
    await closeAdvisoryLockPoolForTests();
  });

  it("refuses a second restore of a different backup while the first is in its destructive step", async () => {
    const first = restoreBackupRecord({ id: "backup-a", confirm: "RESTORE", projectRoot: root });
    await vi.waitFor(() => expect(state.restoreStarts).toHaveLength(1), { timeout: 10_000 });

    await expect(
      restoreBackupRecord({ id: "backup-b", confirm: "RESTORE", projectRoot: root }),
    ).rejects.toMatchObject({ name: "ConflictError" });
    expect(state.restoreStarts).toHaveLength(1);

    state.releaseFirstRestore!();
    await expect(first).resolves.toMatchObject({ id: "backup-a" });

    // Released: the next restore proceeds.
    await expect(restoreBackupRecord({ id: "backup-b", confirm: "RESTORE", projectRoot: root })).resolves.toMatchObject({ id: "backup-b" });
    expect(state.restoreStarts).toHaveLength(2);
  });
});
