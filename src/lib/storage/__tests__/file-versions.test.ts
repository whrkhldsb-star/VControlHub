import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = {
  entries: new Map<string, any>(),
  versions: new Map<string, any>(),
  seq: 0,
};

function resetStore() {
  store.entries.clear();
  store.versions.clear();
  store.seq = 0;
}

const {
  assertAccessMock,
  readBufferMock,
  writeBufferMock,
  getNodeMock,
  statMock,
} = vi.hoisted(() => ({
  assertAccessMock: vi.fn(),
  readBufferMock: vi.fn(),
  writeBufferMock: vi.fn(),
  getNodeMock: vi.fn(),
  statMock: vi.fn(),
}));

vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: assertAccessMock,
  releaseStorageQuotaGuard: vi.fn(async () => undefined),
}));

vi.mock("@/lib/storage/file-content", () => ({
  getStorageFileNode: getNodeMock,
  readStorageFileBuffer: readBufferMock,
  writeStorageFileBuffer: writeBufferMock,
}));

vi.mock("@/lib/storage/fs-backend", () => ({
  statBackingObject: statMock,
}));

vi.mock("@/lib/logging", () => ({
  logError: vi.fn(),
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/db", () => ({
  isUniqueViolation: (error: unknown) => (error as { code?: string })?.code === "P2002",
  prisma: {
    fileEntry: {
      findUnique: vi.fn(async ({ where }: any) => store.entries.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: any) => {
        const row = store.entries.get(where.id);
        if (!row) return null;
        Object.assign(row, data);
        return row;
      }),
    },
    fileVersion: {
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        const rows = [...store.versions.values()].filter((v) => {
          if (where.fileEntryId && v.fileEntryId !== where.fileEntryId) return false;
          if (where.id && v.id !== where.id) return false;
          return true;
        });
        if (orderBy?.versionNumber === "desc") {
          rows.sort((a, b) => b.versionNumber - a.versionNumber);
        }
        return rows[0] ?? null;
      }),
      findMany: vi.fn(async ({ where, orderBy, take, skip }: any) => {
        let rows = [...store.versions.values()].filter(
          (v) => v.fileEntryId === where.fileEntryId,
        );
        if (orderBy?.versionNumber === "desc") {
          rows.sort((a, b) => b.versionNumber - a.versionNumber);
        }
        if (typeof skip === "number") rows = rows.slice(skip);
        if (typeof take === "number") rows = rows.slice(0, take);
        return rows.map((r) => ({
          ...r,
          createdBy: r.createdBy ?? null,
        }));
      }),
      create: vi.fn(async ({ data, include }: any) => {
        // (fileEntryId, versionNumber) is unique, as in the schema.
        if ([...store.versions.values()].some((v) => v.fileEntryId === data.fileEntryId && v.versionNumber === data.versionNumber)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        store.seq += 1;
        const row = {
          id: `ver_${store.seq}`,
          createdAt: new Date("2026-07-15T12:00:00Z"),
          createdBy: include?.createdBy ? { username: "Admin", email: "a@b.c" } : null,
          ...data,
        };
        store.versions.set(row.id, row);
        return row;
      }),
      delete: vi.fn(async ({ where }: any) => {
        store.versions.delete(where.id);
      }),
    },
  },
}));

describe("file-versions service", () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetStore();
    vi.resetModules();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fv-"));
    process.env.FILE_VERSION_DIR = tmpDir;
    process.env.FILE_VERSION_KEEP = "2";
    process.env.FILE_VERSION_MAX_BYTES = String(1024 * 1024);
    assertAccessMock.mockResolvedValue({ allowed: true });
    statMock.mockReset();
    statMock.mockResolvedValue({ size: 16, lastModifiedMs: 1_000 });
    store.entries.set("fe_1", {
      id: "fe_1",
      name: "notes.txt",
      entryType: "FILE",
      mimeType: "text/plain",
      relativePath: "docs/notes.txt",
      storageNodeId: "node_1",
      isDeleted: false,
      updatedAt: new Date(),
      storageNode: {
        id: "node_1",
        name: "local",
        driver: "LOCAL",
        basePath: tmpDir,
      },
    });
    readBufferMock.mockResolvedValue(Buffer.from("hello v1"));
    writeBufferMock.mockResolvedValue(path.join(tmpDir, "docs/notes.txt"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("snapshots current body before overwrite and retains only latest N", async () => {
    const mod = await import("@/lib/storage/file-versions");
    const a = await mod.snapshotFileVersionBeforeOverwrite({
      fileEntryId: "fe_1",
      userId: "u1",
      reason: "UPLOAD",
    });
    expect(a?.versionNumber).toBe(1);
    expect(a?.checksumSha256).toHaveLength(64);
    const rows1 = await mod.listFileVersions({
      fileEntryId: "fe_1",
      session: { userId: "u1" } as never,
    });
    expect(rows1).toHaveLength(1);

    readBufferMock.mockResolvedValue(Buffer.from("hello v2"));
    await mod.snapshotFileVersionBeforeOverwrite({
      fileEntryId: "fe_1",
      userId: "u1",
      reason: "EDIT",
    });
    readBufferMock.mockResolvedValue(Buffer.from("hello v3"));
    await mod.snapshotFileVersionBeforeOverwrite({
      fileEntryId: "fe_1",
      userId: "u1",
      reason: "EDIT",
    });

    const rows = await mod.listFileVersions({
      fileEntryId: "fe_1",
      session: { userId: "u1" } as never,
    });
    // keep=2
    expect(rows).toHaveLength(2);
    expect(rows[0]!.versionNumber).toBe(3);
    expect(rows[1]!.versionNumber).toBe(2);
  });

  it("two concurrent snapshots of the same content each keep their own blob", async () => {
    // Both took version 1 and wrote the same path; the one that lost the
    // version race deleted that path, under the winner's row.
    const mod = await import("@/lib/storage/file-versions");
    const [a, b] = await Promise.all([
      mod.snapshotFileVersionBeforeOverwrite({ fileEntryId: "fe_1", userId: "u1", reason: "EDIT" }),
      mod.snapshotFileVersionBeforeOverwrite({ fileEntryId: "fe_1", userId: "u1", reason: "EDIT" }),
    ]);
    expect([a?.versionNumber, b?.versionNumber].sort()).toEqual([1, 2]);
    const rows = [...store.versions.values()];
    expect(new Set(rows.map((row) => row.blobRelativePath)).size).toBe(2);
    for (const row of rows) {
      await expect(fs.readFile(path.join(tmpDir, row.blobRelativePath))).resolves.toEqual(Buffer.from("hello v1"));
    }
  });

  it("restores a version and writes storage + creates restore point", async () => {
    const mod = await import("@/lib/storage/file-versions");
    const snap = await mod.snapshotFileVersionBeforeOverwrite({
      fileEntryId: "fe_1",
      userId: "u1",
      reason: "MANUAL",
    });
    expect(snap).not.toBeNull();

    // current body differs
    readBufferMock.mockResolvedValue(Buffer.from("current body"));
    // restore reads blob from disk written by snapshot
    const result = await mod.restoreFileVersion({
      fileEntryId: "fe_1",
      versionId: snap!.id,
      session: { userId: "u1" } as never,
    });
    expect(result.restored.versionNumber).toBe(1);
    expect(writeBufferMock).toHaveBeenCalled();
    // restore point for current body should exist when read succeeded
    expect(result.newRestorePoint?.reason).toBe("RESTORE_POINT");
  });

  it("skips oversize automatic snapshots BEFORE reading the body", async () => {
    process.env.FILE_VERSION_MAX_BYTES = "4";
    const mod = await import("@/lib/storage/file-versions");
    readBufferMock.mockResolvedValue(Buffer.from("too-big-content"));
    statMock.mockResolvedValue({ size: 10_000_000_000, lastModifiedMs: 1 });
    const snap = await mod.snapshotFileVersionBeforeOverwrite({
      fileEntryId: "fe_1",
      reason: "UPLOAD",
    });
    expect(snap).toBeNull();
    // Regression: a multi-GB overwrite source used to be buffered whole via
    // readStorageFileBuffer before the cap was applied (OOM). The stat
    // pre-check must reject it without reading a single byte.
    expect(readBufferMock).not.toHaveBeenCalled();
  });

  it("skips the snapshot when the backing object is already gone", async () => {
    const mod = await import("@/lib/storage/file-versions");
    statMock.mockResolvedValue(null);
    const snap = await mod.snapshotFileVersionBeforeOverwrite({
      fileEntryId: "fe_1",
      reason: "UPLOAD",
    });
    expect(snap).toBeNull();
    expect(readBufferMock).not.toHaveBeenCalled();
  });

  it("still enforces the cap on the bytes actually read (stat can be stale)", async () => {
    process.env.FILE_VERSION_MAX_BYTES = "4";
    const mod = await import("@/lib/storage/file-versions");
    statMock.mockResolvedValue({ size: 1, lastModifiedMs: 1_000 });
    readBufferMock.mockResolvedValue(Buffer.from("grew-between-stat-and-read"));
    const snap = await mod.snapshotFileVersionBeforeOverwrite({
      fileEntryId: "fe_1",
      reason: "UPLOAD",
    });
    expect(snap).toBeNull();
  });

  it("refuses to restore over current content it could not snapshot, unless the caller allows it", async () => {
    const mod = await import("@/lib/storage/file-versions");
    const snap = await mod.snapshotFileVersionBeforeOverwrite({ fileEntryId: "fe_1", userId: "u1", reason: "MANUAL" });
    expect(snap).not.toBeNull();

    // The current file is now larger than a version may be: no restore point.
    statMock.mockResolvedValue({ size: 10_000_000_000, lastModifiedMs: 2_000 });
    writeBufferMock.mockClear();
    await expect(mod.restoreFileVersion({ fileEntryId: "fe_1", versionId: snap!.id, session: { userId: "u1" } as never }))
      .rejects.toMatchObject({ status: 409 });
    expect(writeBufferMock).not.toHaveBeenCalled();

    const forced = await mod.restoreFileVersion({
      fileEntryId: "fe_1",
      versionId: snap!.id,
      session: { userId: "u1" } as never,
      allowWithoutRestorePoint: true,
    });
    expect(forced.newRestorePoint).toBeNull();
    expect(writeBufferMock).toHaveBeenCalledTimes(1);
  });

  it("restores without asking when there is no current content to keep", async () => {
    const mod = await import("@/lib/storage/file-versions");
    const snap = await mod.snapshotFileVersionBeforeOverwrite({ fileEntryId: "fe_1", userId: "u1", reason: "MANUAL" });
    statMock.mockResolvedValue(null);
    const result = await mod.restoreFileVersion({ fileEntryId: "fe_1", versionId: snap!.id, session: { userId: "u1" } as never });
    expect(result.newRestorePoint).toBeNull();
    expect(writeBufferMock).toHaveBeenCalled();
  });

  it("keeps a new version's blob when the retention pass after it fails", async () => {
    const mod = await import("@/lib/storage/file-versions");
    const { prisma } = await import("@/lib/db");
    // Retention lists the surplus versions; a failed query there used to land
    // in the creation catch, which deleted the blob the new row points at.
    vi.mocked(prisma.fileVersion.findMany).mockRejectedValueOnce(new Error("connection reset"));
    const snap = await mod.snapshotFileVersionBeforeOverwrite({ fileEntryId: "fe_1", userId: "u1", reason: "MANUAL" });
    expect(snap).not.toBeNull();
    const row = store.versions.get(snap!.id);
    await expect(fs.readFile(path.join(tmpDir, row.blobRelativePath), "utf8")).resolves.toBe("hello v1");
  });
});

