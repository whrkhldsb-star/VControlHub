import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireSessionMock,
  sessionHasPermissionMock,
  getMediaItemMock,
  assertStorageAccessMock,
} = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  getMediaItemMock: vi.fn(),
  assertStorageAccessMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-session", () => ({ requireSession: requireSessionMock }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: sessionHasPermissionMock }));
vi.mock("@/lib/media/service", () => ({ getMediaItem: getMediaItemMock }));
vi.mock("@/lib/storage/access-control", () => ({ assertStorageAccess: assertStorageAccessMock }));
vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock("ssh2", () => ({ Client: vi.fn() }));

const { GET } = await import("../route");

let tempRoot: string;

function makeLocalMediaItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "media-1",
    name: "clip.mp4",
    mimeType: "video/mp4",
    relativePath: "videos/clip.mp4",
    storageNode: {
      id: "node-local",
      driver: "LOCAL",
      basePath: tempRoot,
    },
    ...overrides,
  };
}

describe("media stream route", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "vch-media-stream-"));
    await mkdir(path.join(tempRoot, "videos"), { recursive: true });
    await writeFile(path.join(tempRoot, "videos", "clip.mp4"), Buffer.alloc(1000));
    requireSessionMock.mockResolvedValue({ userId: "u1", permissions: ["storage:read"] });
    sessionHasPermissionMock.mockReturnValue(true);
    assertStorageAccessMock.mockResolvedValue({ allowed: true });
    getMediaItemMock.mockResolvedValue(makeLocalMediaItem());
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("streams LOCAL media ranges only after storage read authorization", async () => {
    const response = await GET(
      new Request("https://example.test/api/media/media-1/stream", { headers: { range: "bytes=100-199" } }),
      { params: Promise.resolve({ id: "media-1" }) },
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(response.headers.get("content-length")).toBe("100");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("inline");
    expect(assertStorageAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        storageNodeId: "node-local",
        relativePath: "videos/clip.mp4",
        operation: "read",
      }),
    );
  });

  it("returns shared 416 range headers for unsatisfiable LOCAL media ranges", async () => {
    const response = await GET(
      new Request("https://example.test/api/media/media-1/stream", { headers: { range: "bytes=2000-3000" } }),
      { params: Promise.resolve({ id: "media-1" }) },
    );

    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */1000");
  });

  it("uses shared attachment headers when downloading LOCAL media", async () => {
    const response = await GET(new Request("https://example.test/api/media/media-1/stream?download=1"), {
      params: Promise.resolve({ id: "media-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("1000");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("content-disposition")).toContain("clip.mp4");
  });

  it("fails closed before reading the file when storage authorization denies access", async () => {
    assertStorageAccessMock.mockResolvedValueOnce({ allowed: false, reason: "no grant" });

    const response = await GET(new Request("https://example.test/api/media/media-1/stream"), {
      params: Promise.resolve({ id: "media-1" }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: "FORBIDDEN",
      message: "no grant",
      error: "no grant",
    });
  });

  it("rejects traversal-like media paths before touching local storage", async () => {
    getMediaItemMock.mockResolvedValueOnce(makeLocalMediaItem({ relativePath: "../secret.mp4" }));

    const response = await GET(new Request("https://example.test/api/media/media-1/stream"), {
      params: Promise.resolve({ id: "media-1" }),
    });

    expect(response.status).toBe(404);
  });
});
