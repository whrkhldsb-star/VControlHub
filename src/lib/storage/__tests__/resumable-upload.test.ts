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
}));

vi.mock("@/lib/upload/service", () => ({
  assembleMediaUploadChunks: assembleMock,
  completeMediaUploadSession: completeMock,
  MediaUploadError: class MediaUploadError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "MediaUploadError";
    }
  },
}));

vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: assertAccessMock,
}));

vi.mock("@/lib/storage/file-content", () => ({
  getStorageFileNode: getNodeMock,
  writeStorageFileBuffer: writeBufferMock,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    mediaUploadSession: {
      findFirst: sessionFindFirstMock,
    },
    fileEntry: {
      findFirst: fileEntryFindFirstMock,
      findUnique: vi.fn(async () => null),
      update: fileEntryUpdateMock,
      create: fileEntryCreateMock,
    },
  },
}));

import { completeStorageFileUpload } from "@/lib/storage/resumable-upload";

describe("completeStorageFileUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assembleMock.mockResolvedValue(Buffer.from("hello-world"));
    sessionFindFirstMock.mockResolvedValue({
      filename: "report.bin",
      mimeType: "application/octet-stream",
      storageNodeId: "node_local",
      relativePath: "docs/report.bin",
      status: "UPLOADING",
    });
    assertAccessMock.mockResolvedValue({ allowed: true });
    getNodeMock.mockResolvedValue({ id: "node_local", driver: "LOCAL", basePath: "/data" });
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
      expect.any(Buffer),
    );
    expect(fileEntryCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storageNodeId: "node_local",
        name: "report.bin",
        relativePath: "docs/report.bin",
        size: BigInt(11),
      }),
    });
    expect(completeMock).toHaveBeenCalledWith({
      sessionId: "sess_1",
      userId: "user_1",
      buffer: expect.any(Buffer),
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
    expect(fileEntryUpdateMock).toHaveBeenCalledWith({
      where: { id: "fe_existing" },
      data: expect.objectContaining({
        name: "report.bin",
        isDeleted: false,
        size: BigInt(11),
      }),
    });
    expect(fileEntryCreateMock).not.toHaveBeenCalled();
  });
});
