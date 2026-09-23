import { beforeEach, describe, expect, it, vi } from "vitest";

const { moveBackingObjectMock, fileEntryMock, shareLinkMock } = vi.hoisted(() => ({
  moveBackingObjectMock: vi.fn(),
	fileEntryMock: {
		findFirst: vi.fn(),
		findMany: vi.fn(),
		update: vi.fn(),
	},
	shareLinkMock: {
		findMany: vi.fn(),
		update: vi.fn(),
	},
}));

vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: vi.fn().mockResolvedValue({
    userId: "user-1",
    username: "alice",
    roles: ["operator"],
    currentTeamId: "team-1",
    mustChangePassword: false,
  }),
  sessionHasPermission: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
		fileEntry: fileEntryMock,
		shareLink: shareLinkMock,
		$transaction: vi.fn(async (callback) => callback({ fileEntry: fileEntryMock, shareLink: shareLinkMock })),
  },
}));

vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: vi.fn().mockResolvedValue({ allowed: true }),
  releaseStorageQuotaGuard: vi.fn(async () => undefined),
}));

vi.mock("@/lib/storage/fs-backend", () => ({
  moveBackingObject: moveBackingObjectMock,
  statBackingObject: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/concurrency/advisory-lock", () => ({ tryAcquireAdvisoryLock: vi.fn().mockResolvedValue(async () => undefined) }));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { moveFileAction } from "../move-file-action";
import { mockPrismaFindFirstById } from "@/test/prisma-mock";

const { prisma } = await import("@/lib/db");
const { assertStorageAccess } = await import("@/lib/storage/access-control");

const baseEntry = {
  id: "file-1",
  name: "a.txt",
  relativePath: "team-a/a.txt",
  entryType: "FILE",
  storageNodeId: "node-1",
  storageNode: {
    id: "node-1",
    driver: "SFTP" as const,
    basePath: "/srv/storage",
    host: null,
    port: null,
    username: null,
    server: {
      host: "203.0.113.10",
      port: 22,
      username: "root",
      connectionType: "SSH_KEY" as const,
      password: null,
      sshKey: { privateKey: "PRIVATE KEY" },
    },
  },
};

function mockEntryLookup(entry: unknown) {
	// Entry lookup uses where.id: string; collision probe uses where.id: { not }.
	mockPrismaFindFirstById(prisma.fileEntry.findFirst as never, entry);
}

describe("moveFileAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertStorageAccess).mockResolvedValue({ allowed: true });
    vi.mocked(prisma.fileEntry.findFirst).mockResolvedValue(null);
    shareLinkMock.findMany.mockResolvedValue([]);
    fileEntryMock.findMany.mockResolvedValue([]);
    moveBackingObjectMock.mockResolvedValue(undefined);
  });

  it("rollback failure must retain an unconfirmed outcome", async () => {
    mockEntryLookup(baseEntry);
    moveBackingObjectMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("rollback connection lost"));
    fileEntryMock.update.mockRejectedValueOnce(new Error("database offline"));
    const form = new FormData();
    form.set("fileEntryId", "file-1");
    form.set("targetDir", "team-b");
    const { executeMoveFile } = await import("@/lib/files/move-operation");
    const { FileOperationUncertainError } = await import("@/lib/files/operation-schema");
    let failure: unknown;
    try { await executeMoveFile({userId: "user-1", currentTeamId: "team-1", roles: ["operator"]} as never, form); } catch (error) { failure = error; }
    expect(moveBackingObjectMock).toHaveBeenCalledTimes(2);
    expect(failure).toBeInstanceOf(FileOperationUncertainError);
  });

  it("validates destination ACL before updating DB", async () => {
    mockEntryLookup({
      ...baseEntry,
      storageNode: { ...baseEntry.storageNode, driver: "SFTP" as const },
    });
    vi.mocked(assertStorageAccess)
      .mockResolvedValueOnce({ allowed: true }) // source
      .mockResolvedValueOnce({
        allowed: false,
        reason: "no_access",
      }); // destination

    const formData = new FormData();
    formData.set("fileEntryId", "file-1");
    formData.set("targetDir", "team-b");

    const result = await moveFileAction(null, formData);

    // Denials render through storageAccessDeniedCopy: stable reason codes map
    // to localized copy at the boundary.
    expect(result).toEqual({ error: "没有此存储节点或路径的访问授权" });
    expect(assertStorageAccess).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        storageNodeId: "node-1",
        relativePath: "team-a/a.txt",
        operation: "write",
        session: expect.objectContaining({ userId: "user-1" }),
      }),
    );
    expect(assertStorageAccess).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        storageNodeId: "node-1",
        relativePath: "team-b/a.txt",
        operation: "write",
      }),
    );
    expect(moveBackingObjectMock).not.toHaveBeenCalled();
    expect(prisma.fileEntry.update).not.toHaveBeenCalled();
  });

  it("loads WebDAV credentials, pinned host keys and Agent routing for the backing move", async () => {
    mockEntryLookup({ ...baseEntry, storageNode: { ...baseEntry.storageNode, driver: "WEBDAV", webdavConfigEncrypted: "encrypted" } });
    const form = new FormData();
    form.set("fileEntryId", "file-1");
    form.set("targetDir", ".");
    await moveFileAction(null, form);
    expect(prisma.fileEntry.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ storageNode: { select: expect.objectContaining({
        webdavConfigEncrypted: true, hostKeySha256: true,
        server: { select: expect.objectContaining({ id: true, managementMode: true, hostKeySha256: true }) },
      }) } }),
    }));
    expect(moveBackingObjectMock).toHaveBeenCalledWith(expect.objectContaining({
      storageNode: expect.objectContaining({ webdavConfigEncrypted: "encrypted" }),
      newRelativePath: "a.txt",
    }));
  });

  it("rejects moving a directory inside itself before touching storage", async () => {
    mockEntryLookup({ ...baseEntry, name: "docs", relativePath: "docs", entryType: "DIRECTORY" });
    const form = new FormData();
    form.set("fileEntryId", "file-1");
    form.set("targetDir", "docs/nested");
    const result = await moveFileAction(null, form);
    expect(result.error).toBeTruthy();
    expect(moveBackingObjectMock).not.toHaveBeenCalled();
    expect(prisma.fileEntry.update).not.toHaveBeenCalled();
  });

  it("rejects moves when source path lacks write ACL even if destination is allowed", async () => {
    mockEntryLookup(baseEntry);
    vi.mocked(assertStorageAccess).mockResolvedValueOnce({
      allowed: false,
      reason: "path_not_allowed",
    });

    const formData = new FormData();
    formData.set("fileEntryId", "file-1");
    formData.set("targetDir", "public");

    const result = await moveFileAction(null, formData);

    // Reason codes map to their own localized copy at the boundary.
    expect(result).toEqual({ error: "请求路径无效或超出授权范围" });
    expect(assertStorageAccess).toHaveBeenCalledTimes(1);
    expect(assertStorageAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        relativePath: "team-a/a.txt",
        operation: "write",
      }),
    );
    expect(moveBackingObjectMock).not.toHaveBeenCalled();
    expect(prisma.fileEntry.update).not.toHaveBeenCalled();
  });

  it("team-scopes entry lookup so foreign-team ids are not found", async () => {
    vi.mocked(prisma.fileEntry.findFirst).mockResolvedValueOnce(null);

    const formData = new FormData();
    formData.set("fileEntryId", "foreign-file");
    formData.set("targetDir", "team-b");

    const result = await moveFileAction(null, formData);

    expect(result).toEqual({ error: "文件条目不存在" });
    expect(prisma.fileEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "foreign-file",
          isDeleted: false,
          storageNode: expect.any(Object),
        }),
      }),
    );
    expect(assertStorageAccess).not.toHaveBeenCalled();
    expect(moveBackingObjectMock).not.toHaveBeenCalled();
  });

  it("rejects unsafe target directories before ACL and DB writes", async () => {
    mockEntryLookup(baseEntry);

    const formData = new FormData();
    formData.set("fileEntryId", "file-1");
    formData.set("targetDir", "../escape");

    const result = await moveFileAction(null, formData);

    expect(result.error).toMatch(/Path/);
    expect(assertStorageAccess).not.toHaveBeenCalled();
    expect(moveBackingObjectMock).not.toHaveBeenCalled();
    expect(prisma.fileEntry.update).not.toHaveBeenCalled();
  });

  it("returns an error and skips DB updates when LOCAL move fails inside the adapter", async () => {
    const localEntry = {
      ...baseEntry,
      storageNode: { driver: "LOCAL" as const, basePath: "/srv/storage" },
    };
    mockEntryLookup(localEntry);
    moveBackingObjectMock.mockRejectedValueOnce(new Error("EXDEV"));
    expect(localEntry.storageNode.driver).toBe("LOCAL");
    expect(localEntry.entryType).toBe("FILE");

    const formData = new FormData();
    formData.set("fileEntryId", "file-1");
    formData.set("targetDir", "team-b");

    const result = await moveFileAction(null, formData);

    expect(moveBackingObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        oldRelativePath: "team-a/a.txt",
        newRelativePath: "team-b/a.txt",
      }),
    );
    expect(result).toEqual({ error: "本地文件移动失败：EXDEV" });
    expect(prisma.fileEntry.update).not.toHaveBeenCalled();
  });

  it("moves LOCAL files through the fs-backend adapter before DB update", async () => {
    const localEntry = {
      ...baseEntry,
      storageNode: {
        driver: "LOCAL" as const,
        basePath: "/var/lib/${APP_SLUG:-vcontrolhub}/storage",
      },
    };
    mockEntryLookup(localEntry);
    moveBackingObjectMock.mockResolvedValueOnce(undefined);
    vi.mocked(prisma.fileEntry.update).mockResolvedValueOnce({ id: "file-1" } as never);

    const formData = new FormData();
    formData.set("fileEntryId", "file-1");
    formData.set("targetDir", "team-b");

    const result = await moveFileAction(null, formData);

    expect(result).toEqual({ success: "已移动到 /team-b/a.txt" });
    expect(assertStorageAccess).toHaveBeenCalledTimes(2);
    expect(moveBackingObjectMock).toHaveBeenCalledWith({
      storageNode: localEntry.storageNode,
      oldRelativePath: "team-a/a.txt",
      newRelativePath: "team-b/a.txt",
    });
    expect(prisma.fileEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "file-1" },
        data: { relativePath: "team-b/a.txt" },
      }),
    );
  });

  it("moves SFTP files through the fs-backend adapter before updating the DB index", async () => {
    mockEntryLookup(baseEntry);
    moveBackingObjectMock.mockResolvedValueOnce(undefined);
    vi.mocked(prisma.fileEntry.update).mockResolvedValueOnce({
      id: "file-1",
    } as never);

    const formData = new FormData();
    formData.set("fileEntryId", "file-1");
    formData.set("targetDir", "team-b");

    const result = await moveFileAction(null, formData);

    expect(result).toEqual({ success: "已移动到 /team-b/a.txt" });
    expect(moveBackingObjectMock).toHaveBeenCalledWith({
      storageNode: baseEntry.storageNode,
      oldRelativePath: "team-a/a.txt",
      newRelativePath: "team-b/a.txt",
    });
    expect(prisma.fileEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "file-1" },
        data: { relativePath: "team-b/a.txt" },
      }),
    );
  });

  it("keeps active file shares usable by rewriting their path in the move transaction", async () => {
    mockEntryLookup(baseEntry);
    shareLinkMock.findMany.mockResolvedValueOnce([
      { id: "share-1", path: "team-a/a.txt" },
    ]);

    const formData = new FormData();
    formData.set("fileEntryId", "file-1");
    formData.set("targetDir", "team-b");

    const result = await moveFileAction(null, formData);

    expect(result.error).toBeUndefined();
    expect(shareLinkMock.findMany).toHaveBeenCalledWith({
      where: {
        storageNodeId: "node-1",
        revokedAt: null,
        OR: [{ path: "team-a/a.txt" }],
      },
      select: { id: true, path: true },
      take: 10_001,
    });
    expect(shareLinkMock.update).toHaveBeenCalledWith({
      where: { id: "share-1" },
      data: { path: "team-b/a.txt" },
    });
  });

  it("moves SFTP files into a nested target path through the fs-backend adapter", async () => {
    mockEntryLookup(baseEntry);
    moveBackingObjectMock.mockResolvedValueOnce(undefined);
    vi.mocked(prisma.fileEntry.update).mockResolvedValueOnce({
      id: "file-1",
    } as never);

    const formData = new FormData();
    formData.set("fileEntryId", "file-1");
    formData.set("targetDir", "team-b/nested");

    const result = await moveFileAction(null, formData);

    expect(result).toEqual({ success: "已移动到 /team-b/nested/a.txt" });
    expect(moveBackingObjectMock).toHaveBeenCalledWith({
      storageNode: baseEntry.storageNode,
      oldRelativePath: "team-a/a.txt",
      newRelativePath: "team-b/nested/a.txt",
    });
    expect(prisma.fileEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "file-1" },
        data: { relativePath: "team-b/nested/a.txt" },
      }),
    );
  });

  it("keeps untyped remote failures unconfirmed instead of offering a replay", async () => {
    mockEntryLookup(baseEntry);
    moveBackingObjectMock.mockRejectedValueOnce(new Error("permission denied"));

    const formData = new FormData();
    formData.set("fileEntryId", "file-1");
    formData.set("targetDir", "team-b");

    const result = await moveFileAction(null, formData);

    expect(result).toMatchObject({ needsReconcile: true, error: expect.stringContaining("permission denied") });
    expect(prisma.fileEntry.update).not.toHaveBeenCalled();
  });

  it("rewrites all descendant paths because recycle-bin bytes move with their parent", async () => {
    const dirEntry = {
      ...baseEntry,
      id: "dir-1",
      name: "team-a",
      relativePath: "team-a",
      entryType: "DIRECTORY",
    };
    // mockPrismaFindFirstById handles entry load (string id) + collision probe ({ not })
    mockEntryLookup(dirEntry);
    fileEntryMock.findMany.mockResolvedValue([
      { id: "child-live", relativePath: "team-a/live.txt" },
      { id: "child-trash", relativePath: "team-a/deleted.txt" },
    ]);
    fileEntryMock.update.mockResolvedValue({ id: "ok" });

    const formData = new FormData();
    formData.set("fileEntryId", "dir-1");
    formData.set("targetDir", "archive");

    const result = await moveFileAction(null, formData);

    expect(result.error).toBeUndefined();
    expect(result.success).toBeTruthy();
    expect(fileEntryMock.findMany).toHaveBeenCalledWith({
      where: {
        storageNodeId: "node-1",
        relativePath: { startsWith: "team-a/" },
      },
      select: { id: true, relativePath: true },
      take: 10_001,
    });
    expect(fileEntryMock.update).toHaveBeenCalledWith({
      where: { id: "child-live" },
      data: { relativePath: "archive/team-a/live.txt" },
    });
    expect(fileEntryMock.update).toHaveBeenCalledWith({ where: { id: "child-trash" }, data: { relativePath: "archive/team-a/deleted.txt" } });
  });

});
