import { mkdir, rm, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getApiSessionMock, imageFindUniqueMock } = vi.hoisted(() => ({
  getApiSessionMock: vi.fn(),
  imageFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", () => ({
  getApiSession: getApiSessionMock,
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

const ownerSession = {
  userId: "u1",
  username: "owner",
  roles: ["user"],
  mustChangePassword: false,
};
const imageReaderSession = {
  userId: "reader_1",
  username: "reader",
  roles: ["admin"],
  mustChangePassword: false,
};
const otherSession = {
  userId: "u2",
  username: "other",
  roles: ["user"],
  mustChangePassword: false,
};
const params = { params: Promise.resolve({ id: "img_1" }) };
const uploadRoot = "/tmp/vcontrolhub-image-file-test";

function image(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "img_1",
    storageKey: "2026/photo.png",
    mimeType: "image/png",
    filename: "photo.png",
    isPublic: true,
    userId: "u1",
    ...overrides,
  };
}

describe("GET /api/images/[id]/file", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    getApiSessionMock.mockResolvedValue(null);
    await mkdir(`${uploadRoot}/2026`, { recursive: true });
    await writeFile(`${uploadRoot}/2026/photo.png`, Buffer.from("png"));
  });

  afterEach(async () => {
    await rm(uploadRoot, { recursive: true, force: true });
  });

  it("streams public images without requiring a logged-in session so copied external links work", async () => {
    imageFindUniqueMock.mockResolvedValue(image({ isPublic: true }));

    const response = await GET(
      new Request("http://local/api/images/img_1/file"),
      params,
    );

    expect(response.status).toBe(200);
    expect(getApiSessionMock).not.toHaveBeenCalled();
    expect(imageFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "img_1" },
      select: {
        id: true,
        storageKey: true,
        mimeType: true,
        filename: true,
        isPublic: true,
        userId: true,
      },
    });
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Length")).toBe("3");
    expect(response.headers.get("Cache-Control")).toContain("public");
  });

  it("lets the owner preview a private image from the image-bed page", async () => {
    getApiSessionMock.mockResolvedValue(ownerSession);
    imageFindUniqueMock.mockResolvedValue(image({ isPublic: false }));

    const response = await GET(
      new Request("http://local/api/images/img_1/file"),
      params,
    );

    expect(response.status).toBe(200);
    expect(getApiSessionMock).toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("lets image readers preview another user's private image", async () => {
    getApiSessionMock.mockResolvedValue(imageReaderSession);
    imageFindUniqueMock.mockResolvedValue(
      image({ isPublic: false, userId: "u1" }),
    );

    const response = await GET(
      new Request("http://local/api/images/img_1/file"),
      params,
    );

    expect(response.status).toBe(200);
  });

  it("blocks non-public images from unrelated users", async () => {
    getApiSessionMock.mockResolvedValue(otherSession);
    imageFindUniqueMock.mockResolvedValue(
      image({ isPublic: false, userId: "u1" }),
    );

    const response = await GET(
      new Request("http://local/api/images/img_1/file"),
      params,
    );
    expect(response.status).toBe(404);
  });

  it("rejects escaped storage keys before touching outside the upload root", async () => {
    imageFindUniqueMock.mockResolvedValue(
      image({
        storageKey: "../../etc/passwd",
        mimeType: "text/plain",
        filename: "passwd",
        isPublic: true,
      }),
    );

    const response = await GET(
      new Request("http://local/api/images/img_1/file"),
      params,
    );
    expect(response.status).toBe(400);
  });
});
