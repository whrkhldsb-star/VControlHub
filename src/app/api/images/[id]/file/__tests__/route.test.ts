import { mkdir, rm, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiSessionMock, imageFindUniqueMock } = vi.hoisted(() => ({
  requireApiSessionMock: vi.fn(),
  imageFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: requireApiSessionMock,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    imageUpload: { findUnique: imageFindUniqueMock },
  },
}));
vi.mock("@/lib/image-bed/constants", () => ({
  UPLOAD_DIR: "/tmp/vcontrolhub-image-file-test",
}));

import { GET } from "../route";

const session = { userId: "u1", username: "admin", roles: ["admin"] };
const params = { params: Promise.resolve({ id: "img_1" }) };
const uploadRoot = "/tmp/vcontrolhub-image-file-test";

describe("GET /api/images/[id]/file", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await mkdir(`${uploadRoot}/2026`, { recursive: true });
    await writeFile(`${uploadRoot}/2026/photo.png`, Buffer.from("png"));
  });

  afterEach(async () => {
    await rm(uploadRoot, { recursive: true, force: true });
  });

  it("uses shared auth guard and streams public images", async () => {
    requireApiSessionMock.mockResolvedValue(session);
    imageFindUniqueMock.mockResolvedValue({
      id: "img_1",
      storageKey: "2026/photo.png",
      mimeType: "image/png",
      filename: "photo.png",
      isPublic: true,
    });

    const response = await GET(
      new Request("http://local/api/images/img_1/file"),
      params,
    );

    expect(response.status).toBe(200);
    expect(requireApiSessionMock).toHaveBeenCalled();
    expect(imageFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "img_1" },
      select: {
        id: true,
        storageKey: true,
        mimeType: true,
        filename: true,
        isPublic: true,
      },
    });
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Length")).toBe("3");
  });

  it("blocks non-public images", async () => {
    requireApiSessionMock.mockResolvedValue(session);
    imageFindUniqueMock.mockResolvedValue({
      id: "img_1",
      storageKey: "2026/photo.png",
      mimeType: "image/png",
      filename: "photo.png",
      isPublic: false,
    });

    const response = await GET(
      new Request("http://local/api/images/img_1/file"),
      params,
    );
    expect(response.status).toBe(404);
  });

  it("rejects escaped storage keys before touching outside the upload root", async () => {
    requireApiSessionMock.mockResolvedValue(session);
    imageFindUniqueMock.mockResolvedValue({
      id: "img_1",
      storageKey: "../../etc/passwd",
      mimeType: "text/plain",
      filename: "passwd",
      isPublic: true,
    });

    const response = await GET(
      new Request("http://local/api/images/img_1/file"),
      params,
    );
    expect(response.status).toBe(400);
  });
});
