import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    fileEntry: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    storageNode: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
  isUniqueViolation: vi.fn(() => false),
}));

import { syncLocalDirectoryEntries } from "../local-sync";

describe("local storage directory sync", () => {
  let root = "";

  beforeEach(async () => {
    vi.clearAllMocks();
    root = await mkdtemp(path.join(tmpdir(), "vcontrolhub-local-sync-"));
    prismaMock.fileEntry.findFirst.mockResolvedValue(null);
    prismaMock.fileEntry.findMany.mockResolvedValue([]);
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.fileEntry.create.mockResolvedValue({});
    prismaMock.fileEntry.createMany.mockImplementation(async ({ data }) => ({ count: data.length }));
    prismaMock.fileEntry.updateMany.mockResolvedValue({ count: 0 });
  });

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("indexes files and folders already present on disk", async () => {
    await mkdir(path.join(root, "photos"));
    await writeFile(path.join(root, "readme.txt"), "hello");

    const result = await syncLocalDirectoryEntries({
      node: {
        id: "node_local",
        name: "Local",
        driver: "LOCAL",
        basePath: root,
      },
    });

    expect(result).toEqual({
      synced: 2,
      created: 2,
      updated: 0,
      deleted: 0,
      errors: [],
    });
    expect(prismaMock.fileEntry.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([{
        storageNodeId: "node_local",
        relativePath: "photos",
        name: "photos",
        entryType: "DIRECTORY",
        mimeType: "inode/directory",
        size: null,
        isDeleted: false,
      }, expect.objectContaining({
        storageNodeId: "node_local",
        relativePath: "readme.txt",
        entryType: "FILE",
        mimeType: "text/plain",
        size: BigInt(5),
      })]),
      skipDuplicates: true,
    });
  });

  it("indexes only the requested directory and preserves its relative path", async () => {
    await mkdir(path.join(root, "photos"));
    await writeFile(path.join(root, "photos", "cover.jpg"), "image");

    const result = await syncLocalDirectoryEntries({
      node: {
        id: "node_local",
        name: "Local",
        driver: "LOCAL",
        basePath: root,
      },
      relativePath: "photos",
    });

    expect(result.created).toBe(1);
    expect(prismaMock.fileEntry.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        relativePath: "photos/cover.jpg",
        name: "cover.jpg",
        entryType: "FILE",
      })],
      skipDuplicates: true,
    });
    expect(prismaMock.$queryRaw.mock.calls[0]![0].values).toContain("photos/");
  });

  it("does not prune indexed rows when the disk inventory is incomplete", async () => {
    await writeFile(path.join(root, "unsupported:name.txt"), "keep");

    const result = await syncLocalDirectoryEntries({
      node: {
        id: "node_local",
        name: "Local",
        driver: "LOCAL",
        basePath: root,
      },
    });

    expect(result.errors[0]).toContain("Skipped unsupported entry");
    expect(prismaMock.fileEntry.findMany).not.toHaveBeenCalled();
    expect(prismaMock.fileEntry.updateMany).not.toHaveBeenCalled();
  });

  const indexed = (overrides: Record<string, unknown> = {}) => ({
    id: "indexed-file", relativePath: "same.txt", name: "same.txt", entryType: "FILE",
    mimeType: "text/plain", size: BigInt(5), isDeleted: false, updatedAt: new Date("2026-09-07"), ...overrides,
  });
  const sync = (basePath: string) => syncLocalDirectoryEntries({ node: { id: "node_local", name: "Local", driver: "LOCAL", basePath } });

  it("does not change updatedAt or issue per-file lookups for unchanged files", async () => {
    await writeFile(path.join(root, "same.txt"), "hello");
    prismaMock.$queryRaw.mockResolvedValueOnce([indexed()]);
    expect(await sync(root)).toEqual({ synced: 1, created: 0, updated: 0, deleted: 0, errors: [] });
    expect(prismaMock.fileEntry.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.fileEntry.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.fileEntry.createMany).not.toHaveBeenCalled();
  });

  it("guards metadata updates against concurrent deletion or modification", async () => {
    await writeFile(path.join(root, "same.txt"), "changed");
    const row = indexed();
    prismaMock.$queryRaw.mockResolvedValueOnce([row]);
    await sync(root);
    expect(prismaMock.fileEntry.updateMany).toHaveBeenCalledWith({
      where: { id: row.id, isDeleted: false, updatedAt: row.updatedAt },
      data: { name: "same.txt", entryType: "FILE", mimeType: "text/plain", size: BigInt(7) },
    });
  });

  it("includes files uploaded while the index inventory is being read", async () => {
    prismaMock.$queryRaw.mockImplementationOnce(async () => {
      await writeFile(path.join(root, "same.txt"), "hello");
      return [indexed()];
    });
    expect(await sync(root)).toEqual({ synced: 1, created: 0, updated: 0, deleted: 0, errors: [] });
    expect(prismaMock.fileEntry.updateMany).not.toHaveBeenCalled();
  });

  it("preserves recycle-bin entries even when the backing file still exists", async () => {
    await writeFile(path.join(root, "same.txt"), "changed");
    prismaMock.$queryRaw.mockResolvedValueOnce([indexed({ isDeleted: true })]);
    await sync(root);
    expect(prismaMock.fileEntry.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.fileEntry.createMany).not.toHaveBeenCalled();
  });

  it("prunes only unchanged live rows from the completed inventory", async () => {
    const row = indexed();
    prismaMock.$queryRaw.mockResolvedValueOnce([row, indexed({ id: "trash", relativePath: "trash.txt", isDeleted: true })]);
    await sync(root);
    expect(prismaMock.fileEntry.updateMany).toHaveBeenCalledWith({
      where: { storageNodeId: "node_local", isDeleted: false, OR: [{ id: row.id, updatedAt: row.updatedAt }] },
      data: { isDeleted: true },
    });
  });

  it("does not prune after a failed insert batch", async () => {
    await writeFile(path.join(root, "new.txt"), "new");
    prismaMock.$queryRaw.mockResolvedValueOnce([indexed()]);
    prismaMock.fileEntry.createMany.mockRejectedValueOnce(new Error("insert failed"));
    const result = await sync(root);
    expect(result.errors).toHaveLength(1);
    expect(prismaMock.fileEntry.updateMany).not.toHaveBeenCalled();
  });

  it("batches new entries and never overwrites concurrent insert winners", async () => {
    for (let index = 0; index < 501; index++) await writeFile(path.join(root, `new-${index}.txt`), "new");
    prismaMock.fileEntry.createMany.mockResolvedValueOnce({ count: 499 }).mockResolvedValueOnce({ count: 1 });
    const result = await sync(root);
    expect(result.created).toBe(500);
    expect(prismaMock.fileEntry.createMany.mock.calls.map(([input]) => input.data.length)).toEqual([500, 1]);
    expect(prismaMock.fileEntry.createMany.mock.calls.every(([input]) => input.skipDuplicates)).toBe(true);
    expect(prismaMock.fileEntry.updateMany).not.toHaveBeenCalled();
  });
});
