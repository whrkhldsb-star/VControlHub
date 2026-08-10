import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    fileEntry: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
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
    prismaMock.fileEntry.create.mockResolvedValue({});
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
    expect(prismaMock.fileEntry.create).toHaveBeenCalledWith({
      data: {
        storageNodeId: "node_local",
        relativePath: "photos",
        name: "photos",
        entryType: "DIRECTORY",
        mimeType: "inode/directory",
        size: null,
        isDeleted: false,
      },
    });
    expect(prismaMock.fileEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storageNodeId: "node_local",
        relativePath: "readme.txt",
        entryType: "FILE",
        mimeType: "text/plain",
        size: BigInt(5),
      }),
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
    expect(prismaMock.fileEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        relativePath: "photos/cover.jpg",
        name: "cover.jpg",
        entryType: "FILE",
      }),
    });
    expect(prismaMock.fileEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storageNodeId: "node_local",
          relativePath: { startsWith: "photos/" },
        }),
      }),
    );
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
});
