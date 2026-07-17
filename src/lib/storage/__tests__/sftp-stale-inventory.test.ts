import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaFileEntryMock, listRemoteDirectoryMock } = vi.hoisted(() => ({
  prismaFileEntryMock: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  listRemoteDirectoryMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    fileEntry: prismaFileEntryMock,
  },
}));

vi.mock("@/lib/ssh/client", () => ({
  listRemoteDirectory: listRemoteDirectoryMock,
}));

vi.mock("@/lib/storage/ssh-credentials", () => ({
  resolveStorageSshCredentials: vi.fn(() => ({
    host: "203.0.113.10",
    port: 22,
    username: "root",
    privateKey: "[REDACTED PRIVATE KEY]",
    password: null,
    hostKeySha256: "STALE-PIN",
  })),
}));

vi.mock("@/lib/runtime-settings/service", () => ({
  getSftpSyncDirectoryTimeoutMs: vi.fn(async () => 60_000),
}));

import {
  detectAndPruneSftpStaleInventory,
  listSftpNodesForStaleInventory,
} from "../sftp-stale-inventory";

const baseNode = {
  id: "node_1",
  name: "remote",
  driver: "SFTP" as const,
  basePath: "/data",
  host: "203.0.113.10",
  port: 22,
  username: "root",
  hostKeySha256: "STALE-PIN",
  server: {
    id: "srv_1",
    host: "203.0.113.10",
    port: 22,
    username: "root",
    connectionType: "PASSWORD" as const,
    password: "secret",
    hostKeySha256: "STALE-PIN",
    sshKey: null,
  },
};

describe("detectAndPruneSftpStaleInventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips non-SFTP nodes without throwing", async () => {
    const localNode = { ...baseNode, driver: "LOCAL" as const };
    const result = await detectAndPruneSftpStaleInventory({
      // sftp-stale-inventory expects a strict node shape matching
      // SftpSyncNode; the LOCAL branch is rejected at runtime by the
      // driver check inside the service, so this is safe.
      node: localNode as unknown as Parameters<typeof detectAndPruneSftpStaleInventory>[0]["node"],
    });
    expect(result.scanned).toBe(0);
    expect(result.stale).toBe(0);
    expect(result.errors[0]).toContain("Node remote is not SFTP type; skipped");
    expect(listRemoteDirectoryMock).not.toHaveBeenCalled();
  });

  it("prunes entries that are missing from the remote listing", async () => {
    listRemoteDirectoryMock.mockResolvedValueOnce([
      { name: "live.txt", type: "file", size: 12, mtime: 0 },
      { name: "live-dir", type: "directory", size: 0, mtime: 0 },
    ]);
    listRemoteDirectoryMock.mockResolvedValueOnce([
      // sub-directory contents
      { name: "inner.txt", type: "file", size: 4, mtime: 0 },
    ]);

    prismaFileEntryMock.findMany.mockResolvedValueOnce([
      { id: "fe_live", relativePath: "live.txt" },
      { id: "fe_stale_root", relativePath: "ghost.txt" },
      { id: "fe_live_dir", relativePath: "live-dir" },
      { id: "fe_live_inner", relativePath: "live-dir/inner.txt" },
      { id: "fe_stale_inner", relativePath: "live-dir/ghost.txt" },
    ]);

    prismaFileEntryMock.updateMany.mockResolvedValueOnce({ count: 2 });

    const result = await detectAndPruneSftpStaleInventory({
      node: baseNode,
      directoryTimeoutMs: 30_000,
    });

    expect(result.scanned).toBe(3); // live.txt, live-dir, live-dir/inner.txt
    expect(result.stale).toBe(2);
    expect(result.dryRun).toBe(false);
    expect(result.errors).toHaveLength(0);
    expect(listRemoteDirectoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        hostKeySha256: "STALE-PIN",
        remotePath: "/data",
      }),
    );

    // updateMany 只标 isDeleted=true, 不动其它字段
    expect(prismaFileEntryMock.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["fe_stale_root", "fe_stale_inner"] } },
      data: { isDeleted: true },
    });
  });

  it("respects maxDepth and does not descend beyond it", async () => {
    listRemoteDirectoryMock.mockResolvedValueOnce([
      { name: "sub", type: "directory", size: 0, mtime: 0 },
    ]);
    // No second listing: sub-dir contents are out of scope
    prismaFileEntryMock.findMany.mockResolvedValueOnce([]);

    const result = await detectAndPruneSftpStaleInventory({
      node: baseNode,
      maxDepth: 0,
      directoryTimeoutMs: 30_000,
    });

    expect(result.scanned).toBe(1); // sub counted, not its children
    expect(result.stale).toBe(0);
    expect(listRemoteDirectoryMock).toHaveBeenCalledTimes(1);
  });

  it("captures per-directory errors without aborting the rest of the walk", async () => {
    listRemoteDirectoryMock.mockRejectedValueOnce(
      new Error("connection reset"),
    );

    prismaFileEntryMock.findMany.mockResolvedValueOnce([]);

    const result = await detectAndPruneSftpStaleInventory({
      node: baseNode,
      directoryTimeoutMs: 30_000,
    });

    expect(result.scanned).toBe(0);
    expect(result.stale).toBe(0);
    expect(result.errors[0]).toContain("connection reset");
  });

  it("does not write to the database when dryRun is true", async () => {
    listRemoteDirectoryMock.mockResolvedValueOnce([
      { name: "live.txt", type: "file", size: 5, mtime: 0 },
    ]);
    prismaFileEntryMock.findMany.mockResolvedValueOnce([
      { id: "fe_ghost", relativePath: "ghost.txt" },
    ]);

    const result = await detectAndPruneSftpStaleInventory({
      node: baseNode,
      directoryTimeoutMs: 30_000,
      dryRun: true,
    });

    expect(result.stale).toBe(1);
    expect(result.dryRun).toBe(true);
    expect(prismaFileEntryMock.updateMany).not.toHaveBeenCalled();
  });

  it("records duration regardless of outcome", async () => {
    listRemoteDirectoryMock.mockRejectedValueOnce(new Error("boom"));
    prismaFileEntryMock.findMany.mockResolvedValueOnce([]);

    const result = await detectAndPruneSftpStaleInventory({
      node: baseNode,
      directoryTimeoutMs: 30_000,
    });

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.durationMs).toBe("number");
  });
});

describe("listSftpNodesForStaleInventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("only returns SFTP nodes, ordered by name", async () => {
    const prismaStorageNodeMock = {
      findMany: vi.fn(async () => [
        { id: "n1", name: "alpha", driver: "SFTP" },
        { id: "n2", name: "beta", driver: "SFTP" },
      ]),
    };

    // The list helper hits prisma.storageNode, not prisma.fileEntry
    const { prisma } = await import("@/lib/db");
    const originalStorageNode = (prisma as { storageNode?: unknown }).storageNode;
    (prisma as unknown as { storageNode: typeof prismaStorageNodeMock }).storageNode = prismaStorageNodeMock;

    try {
      const result = await listSftpNodesForStaleInventory();
      expect(result.map((n) => n.id)).toEqual(["n1", "n2"]);
      expect(prismaStorageNodeMock.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { driver: "SFTP" },
          orderBy: { name: "asc" },
        }),
      );
    } finally {
      if (originalStorageNode === undefined) {
        delete (prisma as { storageNode?: unknown }).storageNode;
      } else {
        (prisma as unknown as { storageNode: unknown }).storageNode = originalStorageNode;
      }
    }
  });
});
