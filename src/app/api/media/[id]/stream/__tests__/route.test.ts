import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireSessionMock,
  sessionHasPermissionMock,
  getMediaItemMock,
  assertStorageAccessMock,
  connectSshMock,
  readRemoteFileMock,
  resolveStorageSshCredentialsMock,
} = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  getMediaItemMock: vi.fn(),
  assertStorageAccessMock: vi.fn(),
  connectSshMock: vi.fn(),
  readRemoteFileMock: vi.fn(),
  resolveStorageSshCredentialsMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-session", () => ({ requireSession: requireSessionMock }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: sessionHasPermissionMock }));
vi.mock("@/lib/media/service", () => ({ getMediaItem: getMediaItemMock }));
vi.mock("@/lib/storage/access-control", () => ({ assertStorageAccess: assertStorageAccessMock , releaseStorageQuotaGuard: vi.fn(async () => undefined) }));
vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: async (
    _request: Request,
    _options: unknown,
    handler: (ctx: { session: { userId: string; roles: string[]; currentTeamId: string | null } }) => Promise<Response>,
  ) =>
    handler({
      session: { userId: "u1", roles: ["operator"], currentTeamId: null },
    }),
}));
vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock("ssh2", () => ({ Client: vi.fn() }));
vi.mock("@/lib/ssh/client", () => ({
  connectSsh: connectSshMock,
  readRemoteFile: readRemoteFileMock,
}));
vi.mock("@/lib/storage/ssh-credentials", () => ({
  resolveStorageSshCredentials: resolveStorageSshCredentialsMock,
}));

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

function makeRemoteMediaItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "media-1",
    name: "clip.mp4",
    mimeType: "video/mp4",
    relativePath: "videos/clip.mp4",
    storageNode: {
      id: "node-remote",
      driver: "SFTP",
      basePath: "/srv/media",
    },
    ...overrides,
  };
}

/** A fake SFTP client whose read stream we drive by hand. */
function mockRemoteStream() {
  const stream = new PassThrough();
  const end = vi.fn();
  connectSshMock.mockResolvedValue({
    end,
    sftp: (cb: (err: Error | null, sftp: unknown) => void) =>
      cb(null, {
        stat: (_path: string, statCb: (err: Error | null, stats: unknown) => void) =>
          statCb(null, { isFile: () => true, size: 1000 }),
        createReadStream: () => stream,
      }),
  });
  return { stream, end };
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
    resolveStorageSshCredentialsMock.mockReturnValue({
      host: "10.0.0.5",
      port: 22,
      username: "root",
      connectionType: "PASSWORD",
      password: "pw",
    });
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

  /** Mirrors STREAM_IDLE_TIMEOUT_MS in the route. */
  const IDLE_MS = 120_000;

  it("tears down a stalled remote SFTP stream and releases the SSH client", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      getMediaItemMock.mockResolvedValue(makeRemoteMediaItem());
      const { stream, end } = mockRemoteStream();

      const response = await GET(new Request("https://example.test/api/media/media-1/stream"), {
        params: Promise.resolve({ id: "media-1" }),
      });

      expect(response.status).toBe(200);
      // A remote that simply never sends a byte would otherwise hold both the
      // HTTP response and the SSH client open indefinitely.
      expect(end).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(IDLE_MS);

      expect(stream.destroyed).toBe(true);
      expect(end).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a slow but advancing remote transfer alive past the idle budget", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      getMediaItemMock.mockResolvedValue(makeRemoteMediaItem());
      const { stream, end } = mockRemoteStream();

      await GET(new Request("https://example.test/api/media/media-1/stream"), {
        params: Promise.resolve({ id: "media-1" }),
      });

      await vi.advanceTimersByTimeAsync(IDLE_MS - 20_000);
      stream.write(Buffer.alloc(16));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(IDLE_MS - 20_000);

      // Total elapsed is past the budget, but every chunk rearms the timer.
      expect(stream.destroyed).toBe(false);
      expect(end).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects traversal-like media paths before touching local storage", async () => {
    getMediaItemMock.mockResolvedValueOnce(makeLocalMediaItem({ relativePath: "../secret.mp4" }));

    const response = await GET(new Request("https://example.test/api/media/media-1/stream"), {
      params: Promise.resolve({ id: "media-1" }),
    });

    expect(response.status).toBe(404);
  });
});
