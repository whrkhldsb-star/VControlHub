import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  assembleMock,
  completeMock,
  assertAccessMock,
  getNodeMock,
  writeBufferMock,
  fileEntryFindFirstMock,
  fileEntryUpdateMock,
  fileEntryCreateMock,
  sessionFindFirstMock,
  sessionUpdateManyMock,
  webdavStatMock,
} = vi.hoisted(() => ({
  assembleMock: vi.fn(),
  completeMock: vi.fn(),
  assertAccessMock: vi.fn(),
  getNodeMock: vi.fn(),
  writeBufferMock: vi.fn(),
  fileEntryFindFirstMock: vi.fn(),
  fileEntryUpdateMock: vi.fn(),
  fileEntryCreateMock: vi.fn(),
  sessionFindFirstMock: vi.fn(),
  sessionUpdateManyMock: vi.fn(),
  webdavStatMock: vi.fn(),
}));

vi.mock("@/lib/storage/webdav-client", () => ({ createWebDavClient: () => ({ stat: webdavStatMock }) }));

vi.mock("@/lib/upload/service", () => ({
  assembleMediaUploadToFile: assembleMock,
  completeMediaUploadSession: completeMock,
  cleanupMediaUploadTempDir: vi.fn(async () => undefined),
  MediaUploadError: class MediaUploadError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "MediaUploadError";
    }
  },
}));

vi.mock("@/lib/storage/file-overwrite-lock", () => ({ lockStorageFileOverwrite: async () => async () => {} }));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: assertAccessMock,
  releaseStorageQuotaGuard: vi.fn(async () => undefined),
}));

vi.mock("@/lib/storage/file-content", () => ({
  getStorageFileNode: getNodeMock,
  writeStorageFileFromLocalPath: writeBufferMock,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (callback) => { const { prisma } = await import("@/lib/db"); return callback(prisma); }),
    mediaUploadSession: {
      findFirst: sessionFindFirstMock,
      updateMany: sessionUpdateManyMock,
    },
    fileEntry: {
      findFirst: fileEntryFindFirstMock,
      findUnique: vi.fn(async () => null),
      update: fileEntryUpdateMock,
      create: fileEntryCreateMock,
      upsert: fileEntryUpdateMock,
    },
  },
}));

import { completeStorageFileUpload } from "@/lib/storage/resumable-upload";

describe("completeStorageFileUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assembleMock.mockResolvedValue({ path: "/tmp/assembled-fixture", size: 11, checksum: "a".repeat(64) });
    sessionFindFirstMock.mockResolvedValue({
      filename: "report.bin",
      mimeType: "application/octet-stream",
      storageNodeId: "node_local",
      relativePath: "docs/report.bin",
      status: "UPLOADING",
      totalSize: BigInt(11),
      totalChunks: 1,
      receivedChunks: [0],
      expiresAt: new Date(Date.now() + 60_000),
    });
    sessionUpdateManyMock.mockResolvedValue({ count: 1 });
    assertAccessMock.mockResolvedValue({ allowed: true });
    getNodeMock.mockResolvedValue({
      id: "node_local",
      driver: "LOCAL",
      basePath: "/data",
    });
    writeBufferMock.mockResolvedValue("/data/docs/report.bin");
    fileEntryFindFirstMock.mockResolvedValue(null);
    fileEntryCreateMock.mockResolvedValue({ id: "fe_1" });
    completeMock.mockResolvedValue({
      id: "sess_1",
      status: "COMPLETED",
      receivedChunks: [0],
      totalChunks: 1,
    });
  });

  it("writes assembled bytes to storage and creates file index", async () => {
    const result = await completeStorageFileUpload({
      sessionId: "sess_1",
      session: {
        userId: "user_1",
        role: "admin",
        permissions: ["storage:write"],
      } as never,
    });

    expect(writeBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "node_local" }),
      "docs/report.bin",
      "/tmp/assembled-fixture",
    );
    expect(fileEntryUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        storageNodeId: "node_local",
        name: "report.bin",
        relativePath: "docs/report.bin",
        size: BigInt(11),
      }),
    }));
    expect(completeMock).toHaveBeenCalledWith({
      sessionId: "sess_1",
      userId: "user_1",
      checksum: "a".repeat(64),
      finalizationToken: expect.any(String),
      allowedStatuses: ["FINALIZING"],
      transaction: expect.any(Object),
    });
    expect(result).toEqual({
      session: expect.objectContaining({ id: "sess_1", status: "COMPLETED" }),
      relativePath: "docs/report.bin",
      size: 11,
      storageNodeId: "node_local",
    });
  });

  it("updates existing file index instead of creating a new one", async () => {
    fileEntryFindFirstMock.mockResolvedValue({ id: "fe_existing" });
    await completeStorageFileUpload({
      sessionId: "sess_1",
      session: { userId: "user_1" } as never,
    });
    expect(fileEntryUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        name: "report.bin",
        isDeleted: false,
        size: BigInt(11),
      }),
    }));
    expect(fileEntryCreateMock).not.toHaveBeenCalled();
  });

  describe("a folder in the way", () => {
    const lastFailure = () => sessionUpdateManyMock.mock.calls.at(-1)?.[0];

    it("refuses to replace an indexed folder, as a failure to fix and retry rather than one to review", async () => {
      fileEntryFindFirstMock.mockResolvedValue({ id: "folder_1", entryType: "DIRECTORY" });
      await expect(completeStorageFileUpload({ sessionId: "sess_1", session: { userId: "user_1" } as never })).rejects.toMatchObject({ status: 409 });
      expect(writeBufferMock).not.toHaveBeenCalled();
      expect(lastFailure().data).toMatchObject({ status: "FAILED", recoveryRequired: false });
    });

    it("asks a WebDAV server first: a MOVE with Overwrite would delete the whole collection", async () => {
      getNodeMock.mockResolvedValue({ id: "node_dav", driver: "WEBDAV", basePath: "" });
      webdavStatMock.mockResolvedValue({ isDirectory: true });
      await expect(completeStorageFileUpload({ sessionId: "sess_1", session: { userId: "user_1" } as never })).rejects.toMatchObject({ status: 409 });
      expect(webdavStatMock).toHaveBeenCalledWith("docs/report.bin");
      expect(writeBufferMock).not.toHaveBeenCalled();
    });

    it("sees a real folder on a LOCAL disk that the index does not know", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "resumable-"));
      try {
        mkdirSync(path.join(root, "docs", "report.bin"), { recursive: true });
        getNodeMock.mockResolvedValue({ id: "node_local", driver: "LOCAL", basePath: root });
        await expect(completeStorageFileUpload({ sessionId: "sess_1", session: { userId: "user_1" } as never })).rejects.toMatchObject({ status: 409 });
        expect(writeBufferMock).not.toHaveBeenCalled();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  it("does not send a LOCAL upload to manual review when the filesystem refused it before changing anything", async () => {
    // The write is a copy and a rename on this machine: an errno means the target is as it was.
    writeBufferMock.mockRejectedValue(Object.assign(new Error("ENAMETOOLONG: name too long"), { code: "ENAMETOOLONG" }));
    await expect(completeStorageFileUpload({ sessionId: "sess_1", session: { userId: "user_1" } as never })).rejects.toMatchObject({ code: "ENAMETOOLONG" });
    expect(sessionUpdateManyMock.mock.calls.at(-1)?.[0].data).toMatchObject({ status: "FAILED", recoveryRequired: false });
  });

  it("still reviews a remote write that failed, since it may have landed", async () => {
    getNodeMock.mockResolvedValue({ id: "node_sftp", driver: "SFTP", basePath: "/srv" });
    writeBufferMock.mockRejectedValue(Object.assign(new Error("ENOSPC"), { code: "ENOSPC" }));
    await expect(completeStorageFileUpload({ sessionId: "sess_1", session: { userId: "user_1" } as never })).rejects.toMatchObject({ code: "UPLOAD_OUTCOME_UNKNOWN" });
    expect(sessionUpdateManyMock.mock.calls.at(-1)?.[0].data).toMatchObject({ recoveryRequired: true });
  });

  it("claims the active session before writing storage side effects", async () => {
    await completeStorageFileUpload({
      sessionId: "sess_1",
      session: { userId: "user_1" } as never,
    });

    expect(sessionUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "sess_1",
        userId: "user_1",
        status: { in: ["PENDING", "UPLOADING"] },
        expiresAt: { gt: expect.any(Date) },
      },
      data: expect.objectContaining({ status: "FINALIZING", finalizationToken: expect.any(String) }),
    });
    expect(sessionUpdateManyMock.mock.invocationCallOrder[0]).toBeLessThan(assembleMock.mock.invocationCallOrder[0]!);
    expect(assembleMock.mock.invocationCallOrder[0]).toBeLessThan(writeBufferMock.mock.invocationCallOrder[0]!);
  });

  it("refuses duplicate completion before rewriting the storage object", async () => {
    sessionUpdateManyMock.mockResolvedValue({ count: 0 });

    await expect(
      completeStorageFileUpload({
        sessionId: "sess_1",
        session: { userId: "user_1" } as never,
      }),
    ).rejects.toThrow(/active|正在处理|状态|finalizing/i);

    expect(assembleMock).not.toHaveBeenCalled();
    expect(writeBufferMock).not.toHaveBeenCalled();
    expect(fileEntryCreateMock).not.toHaveBeenCalled();
    expect(sessionUpdateManyMock).toHaveBeenCalledTimes(1);
  });

  it("does not fail another request's session when node lookup throws before claiming", async () => {
    getNodeMock.mockRejectedValueOnce(new Error("node lookup unavailable"));
    await expect(completeStorageFileUpload({
      sessionId: "sess_1", session: { userId: "user_1" } as never,
    })).rejects.toThrow("node lookup unavailable");
    expect(sessionUpdateManyMock).not.toHaveBeenCalled();
  });

  it("marks a claimed session failed when storage finalization throws", async () => {
    writeBufferMock.mockRejectedValue(new Error("disk full"));

    await expect(
      completeStorageFileUpload({
        sessionId: "sess_1",
        session: { userId: "user_1" } as never,
      }),
    ).rejects.toMatchObject({ code: "UPLOAD_OUTCOME_UNKNOWN" });

    expect(sessionUpdateManyMock).toHaveBeenLastCalledWith({
      where: expect.objectContaining({ id: "sess_1", userId: "user_1", status: "FINALIZING", finalizationToken: expect.any(String) }),
      data: expect.objectContaining({ status: "FAILED", recoveryRequired: true }),
    });
  });

  it.each(["missing-session", "denied-access", "missing-chunks"])("does no chunk IO for %s", async (failure) => {
    if (failure === "missing-session") sessionFindFirstMock.mockResolvedValueOnce(null);
    if (failure === "denied-access") assertAccessMock.mockResolvedValueOnce({ allowed: false, reason: "permission" });
    if (failure === "missing-chunks") {
      const row = await sessionFindFirstMock();
      sessionFindFirstMock.mockResolvedValueOnce({ ...row, receivedChunks: [] });
    }
    await expect(completeStorageFileUpload({ sessionId: "sess_1", session: { userId: "user_1" } as never })).rejects.toThrow();
    expect(assembleMock).not.toHaveBeenCalled();
    expect(writeBufferMock).not.toHaveBeenCalled();
    expect(sessionUpdateManyMock).not.toHaveBeenCalled();
  });
});
