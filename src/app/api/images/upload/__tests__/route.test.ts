import { readdir, rm } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireApiSessionMock,
  sessionHasPermissionMock,
  verifyBearerTokenMock,
  imageCreateMock,
  storageFindFirstMock,
  assertStorageAccessMock,
	extractMetadataMock,
} = vi.hoisted(() => ({
  requireApiSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  verifyBearerTokenMock: vi.fn(),
  imageCreateMock: vi.fn(),
  storageFindFirstMock: vi.fn(),
  assertStorageAccessMock: vi.fn(),
	extractMetadataMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: requireApiSessionMock,

  isSessionPayload: (value: unknown) => Boolean(value),
}));
vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: sessionHasPermissionMock,
}));
vi.mock("@/lib/auth/bearer-token", () => ({
  verifyBearerToken: verifyBearerTokenMock,
  hasBearerAuthorization: (request: Request) =>
    /^Bearer\s+/i.test(request.headers.get("authorization") ?? ""),
}));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: assertStorageAccessMock,
  releaseStorageQuotaGuard: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    imageUpload: { create: imageCreateMock },
    storageNode: { findFirst: storageFindFirstMock },
  },
}));
vi.mock("@/lib/image-bed/constants", () => ({
  UPLOAD_DIR: "/tmp/vcontrolhub-image-upload-test",
}));
vi.mock("@/lib/image/service", () => ({
  extractMetadata: extractMetadataMock,
  generateThumbnail: vi.fn().mockResolvedValue(Buffer.from("thumb")),
  convertToWebP: vi.fn().mockResolvedValue(Buffer.from("webp")),
  convertToAVIF: vi.fn().mockResolvedValue(Buffer.from("avif")),
}));

import { POST } from "../route";

const uploadRoot = "/tmp/vcontrolhub-image-upload-test";
const session = { userId: "u1", username: "admin", roles: ["admin"], currentTeamId: "team_a" };
let requestSequence = 0;

function uploadRequest(
  extra?: Record<string, string>,
  headers?: Record<string, string>,
) {
  const formData = new FormData();
  formData.set(
    "file",
    new Blob([Buffer.from("png")], { type: "image/png" }),
    "photo.png",
  );
  for (const [key, value] of Object.entries(extra ?? {})) {
    formData.set(key, value);
  }
  return new Request("http://local/api/images/upload", {
    method: "POST",
    body: formData,
		headers: {
      "x-forwarded-for": `192.0.2.${++requestSequence}`,
      ...headers,
    },
  });
}

async function listFiles(root: string) {
  try {
    return await readdir(root);
  } catch {
    return [];
  }
}

describe("POST /api/images/upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue(session);
    sessionHasPermissionMock.mockReturnValue(true);
    verifyBearerTokenMock.mockResolvedValue(null);
    imageCreateMock.mockResolvedValue({ id: "img_1", filename: "photo.png" });
    assertStorageAccessMock.mockResolvedValue({ allowed: true });
		extractMetadataMock.mockResolvedValue({ width: 2, height: 2, format: "png", sizeBytes: 3 });
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
      session: {
        ...session,
        userId: "api_user",
        currentTeamId: "team_token",
        roles: [],
        permissions: ["image:write"],
      },
    });

    const response = await POST(uploadRequest());
    expect(response.status).toBe(201);
    expect(requireApiSessionMock).not.toHaveBeenCalled();
    expect(imageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "api_user",
          teamId: "team_token",
        }),
      }),
    );
  });

  it("does not fall back to a cookie session when an explicit Bearer token is invalid", async () => {
    const response = await POST(
      uploadRequest(undefined, { authorization: "Bearer revoked-token" }),
    );

    expect(response.status).toBe(401);
    expect(requireApiSessionMock).not.toHaveBeenCalled();
    expect(imageCreateMock).not.toHaveBeenCalled();
  });

  it("rejects session callers without storage write permission", async () => {
    sessionHasPermissionMock.mockReturnValueOnce(false);

    const response = await POST(uploadRequest());
    expect(response.status).toBe(403);
  });

	it("rejects MIME-spoofed bytes that cannot be decoded as an image", async () => {
		extractMetadataMock.mockRejectedValueOnce(new Error("unsupported image format"));

		const response = await POST(uploadRequest());

		expect(response.status).toBe(400);
		expect(imageCreateMock).not.toHaveBeenCalled();
		expect(await listFiles(uploadRoot)).toEqual([]);
	});

  it("removes written image-bed files when image record creation fails", async () => {
    imageCreateMock.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await POST(uploadRequest());

    expect(response.status).toBe(500);
    expect(await listFiles(uploadRoot)).toEqual([]);
  });

  it("removes image-bed and LOCAL storage copies when linked image record creation fails", async () => {
    const localRoot = "/tmp/vcontrolhub-image-upload-storage-copy-test";
    await rm(localRoot, { recursive: true, force: true });
    storageFindFirstMock.mockResolvedValueOnce({
      id: "node_1",
      driver: "LOCAL",
      basePath: localRoot,
    });
    imageCreateMock.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await POST(
      uploadRequest({ storageNodeId: "node_1", relativePath: "gallery" }),
    );

    expect(response.status).toBe(500);
    expect(await listFiles(uploadRoot)).toEqual([]);
    expect(await listFiles(`${localRoot}/gallery`)).toEqual([]);
    await rm(localRoot, { recursive: true, force: true });
  });
});
