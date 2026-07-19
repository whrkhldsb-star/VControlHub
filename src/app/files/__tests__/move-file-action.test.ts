import { beforeEach, describe, expect, it, vi } from "vitest";

const { moveBackingObjectMock, fileEntryMock } = vi.hoisted(() => ({
  moveBackingObjectMock: vi.fn(),
	fileEntryMock: {
		findFirst: vi.fn(),
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
		$transaction: vi.fn(async (callback) => callback({ fileEntry: fileEntryMock })),
  },
}));

vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("@/lib/storage/fs-backend", () => ({
  moveBackingObject: moveBackingObjectMock,
}));

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
    moveBackingObjectMock.mockResolvedValue(undefined);
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
        reason: "没有该存储节点或路径的访问授权",
      }); // destination

    const formData = new FormData();
    formData.set("fileEntryId", "file-1");
    formData.set("targetDir", "team-b");

    const result = await moveFileAction(null, formData);

    expect(result).toEqual({ error: "没有该存储节点或路径的访问授权" });
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

  it("rejects moves when source path lacks write ACL even if destination is allowed", async () => {
    mockEntryLookup(baseEntry);
    vi.mocked(assertStorageAccess).mockResolvedValueOnce({
      allowed: false,
      reason: "source grant missing",
    });

    const formData = new FormData();
    formData.set("fileEntryId", "file-1");
    formData.set("targetDir", "public");

    const result = await moveFileAction(null, formData);

    expect(result).toEqual({ error: "source grant missing" });
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

  it("surfaces SFTP adapter errors with a remote driver label", async () => {
    mockEntryLookup(baseEntry);
    moveBackingObjectMock.mockRejectedValueOnce(new Error("permission denied"));

    const formData = new FormData();
    formData.set("fileEntryId", "file-1");
    formData.set("targetDir", "team-b");

    const result = await moveFileAction(null, formData);

    expect(result).toEqual({ error: "远端文件移动失败：permission denied" });
    expect(prisma.fileEntry.update).not.toHaveBeenCalled();
  });
});
