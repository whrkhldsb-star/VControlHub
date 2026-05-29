import { rm } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireApiSessionMock,
  sessionHasPermissionMock,
  verifyBearerTokenMock,
  imageCreateMock,
  storageFindUniqueMock,
} = vi.hoisted(() => ({
  requireApiSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  verifyBearerTokenMock: vi.fn(),
  imageCreateMock: vi.fn(),
  storageFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: requireApiSessionMock,
}));
vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: sessionHasPermissionMock,
}));
vi.mock("@/lib/auth/bearer-token", () => ({
  verifyBearerToken: verifyBearerTokenMock,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    imageUpload: { create: imageCreateMock },
    storageNode: { findUnique: storageFindUniqueMock },
  },
}));
vi.mock("@/lib/image-bed/constants", () => ({
  UPLOAD_DIR: "/tmp/vcontrolhub-image-upload-test",
}));
vi.mock("@/lib/image/service", () => ({
  extractMetadata: vi.fn().mockResolvedValue({ width: 2, height: 2 }),
  generateThumbnail: vi.fn().mockResolvedValue(Buffer.from("thumb")),
  convertToWebP: vi.fn().mockResolvedValue(Buffer.from("webp")),
  convertToAVIF: vi.fn().mockResolvedValue(Buffer.from("avif")),
}));

import { POST } from "../route";

const uploadRoot = "/tmp/vcontrolhub-image-upload-test";
const session = { userId: "u1", username: "admin", roles: ["admin"] };

function uploadRequest() {
  const formData = new FormData();
  formData.set(
    "file",
    new Blob([Buffer.from("png")], { type: "image/png" }),
    "photo.png",
  );
  return new Request("http://local/api/images/upload", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/images/upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue(session);
    sessionHasPermissionMock.mockReturnValue(true);
    verifyBearerTokenMock.mockResolvedValue(null);
    imageCreateMock.mockResolvedValue({ id: "img_1", filename: "photo.png" });
  });

  afterEach(async () => {
    await rm(uploadRoot, { recursive: true, force: true });
  });

  it("keeps session upload permission and creates image records", async () => {
    const response = await POST(uploadRequest());
    expect(response.status).toBe(201);
    expect(requireApiSessionMock).toHaveBeenCalled();
    expect(sessionHasPermissionMock).toHaveBeenCalledWith(
      session,
      "storage:write",
    );
    expect(imageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "u1", mimeType: "image/png" }),
      }),
    );
  });

  it("keeps Bearer token image:write uploads without a session", async () => {
    verifyBearerTokenMock.mockResolvedValueOnce({
      userId: "api_user",
      tokenId: "tok_1",
      scopes: ["image:write"],
    });

    const response = await POST(uploadRequest());
    expect(response.status).toBe(201);
    expect(requireApiSessionMock).not.toHaveBeenCalled();
    expect(imageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "api_user" }),
      }),
    );
  });

  it("rejects session callers without storage write permission", async () => {
    sessionHasPermissionMock.mockReturnValueOnce(false);

    const response = await POST(uploadRequest());
    expect(response.status).toBe(403);
  });
});
