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
} = vi.hoisted(() => ({
  assertAccessMock: vi.fn(),
  readBufferMock: vi.fn(),
  writeBufferMock: vi.fn(),
  getNodeMock: vi.fn(),
}));

vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: assertAccessMock,
}));

vi.mock("@/lib/storage/file-content", () => ({
  getStorageFileNode: getNodeMock,
  readStorageFileBuffer: readBufferMock,
  writeStorageFileBuffer: writeBufferMock,
}));

vi.mock("@/lib/logging", () => ({
  logError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
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

  it("skips oversize automatic snapshots", async () => {
    process.env.FILE_VERSION_MAX_BYTES = "4";
    const mod = await import("@/lib/storage/file-versions");
    readBufferMock.mockResolvedValue(Buffer.from("too-big-content"));
    const snap = await mod.snapshotFileVersionBeforeOverwrite({
      fileEntryId: "fe_1",
      reason: "UPLOAD",
    });
    expect(snap).toBeNull();
  });
});
