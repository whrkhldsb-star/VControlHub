import { describe, expect, it, vi } from "vitest";

const { requireApiPermissionMock, getDraftMock, saveDraftMock } = vi.hoisted(() => ({
  requireApiPermissionMock: vi.fn(),
  getDraftMock: vi.fn(),
  saveDraftMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
}));

vi.mock("@/lib/storage/service", () => ({
  getLocalEditableFileDraft: getDraftMock,
  saveLocalEditableFileDraft: saveDraftMock,
}));

import { GET, PUT } from "../route";

const params = Promise.resolve({ id: "file_1" });

describe("/api/files/editable/[id]", () => {
  it("loads local editable file drafts", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_1", username: "admin", roles: ["admin"] },
    });
    getDraftMock.mockResolvedValueOnce({
      fileEntryId: "file_1",
      name: "notes.txt",
      relativePath: "docs/notes.txt",
      content: "hello",
      byteSize: 5,
      updatedAt: "2026-06-06T00:00:00.000Z",
    });

    const response = await GET(new Request("https://app.example.test/api/files/editable/file_1"), { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getDraftMock).toHaveBeenCalledWith({
      fileEntryId: "file_1",
      session: { userId: "u_1", username: "admin", roles: ["admin"] },
    });
    expect(body.draft).toMatchObject({ content: "hello", byteSize: 5 });
  });

  it("saves edited file content through the guarded route", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_1", username: "admin", roles: ["admin"] },
    });
    saveDraftMock.mockResolvedValueOnce({
      fileEntryId: "file_1",
      name: "notes.txt",
      relativePath: "docs/notes.txt",
      byteSize: 11,
      previousByteSize: 5,
      updatedAt: "2026-06-06T00:01:00.000Z",
    });

    const response = await PUT(
      new Request("https://app.example.test/api/files/editable/file_1", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hello again" }),
      }),
      { params },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(saveDraftMock).toHaveBeenCalledWith({
      fileEntryId: "file_1",
      content: "hello again",
      session: { userId: "u_1", username: "admin", roles: ["admin"] },
    });
    expect(body).toMatchObject({ success: true, file: { byteSize: 11 } });
  });

  it("rejects oversized editor saves before writing", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_1", username: "admin", roles: ["admin"] },
    });

    const response = await PUT(
      new Request("https://app.example.test/api/files/editable/file_1", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "x".repeat(512 * 1024 + 1) }),
      }),
      { params },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_FAILED",
      error: expect.stringContaining("文件超过 512 KB，暂不支持在线编辑"),
    });
    expect(saveDraftMock).not.toHaveBeenCalled();
  });
});
