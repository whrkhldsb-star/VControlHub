import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getMediaItemMock, assertStorageAccessMock, connectSshMock, sftpStatMock } =
  vi.hoisted(() => ({
    getMediaItemMock: vi.fn(),
    assertStorageAccessMock: vi.fn(),
    connectSshMock: vi.fn(),
    sftpStatMock: vi.fn(),
  }));

vi.mock("@/lib/media/service", () => ({ getMediaItem: getMediaItemMock }));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: assertStorageAccessMock,
}));
vi.mock("@/lib/ssh/client", () => ({ connectSsh: connectSshMock }));
// Credential decryption needs the real key material; the breaker behaviour under
// test starts after credentials resolve.
vi.mock("@/lib/storage/ssh-credentials", () => ({
  resolveStorageSshCredentials: () => ({
    host: "10.0.0.9",
    port: 22,
    username: "root",
    connectionType: "PASSWORD",
    password: "pw",
    hostKeySha256: null,
  }),
}));
vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: async (
    _request: Request,
    _options: unknown,
    handler: (ctx: {
      session: { userId: string; roles: string[]; currentTeamId: string | null };
    }) => Promise<Response>,
  ) =>
    handler({
      session: { userId: "u1", roles: ["operator"], currentTeamId: null },
    }),
}));
vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock("ssh2", () => ({ Client: vi.fn() }));

let tempRoot: string;
let cacheRoot: string;

/** An SFTP client that connects fine but cannot read the requested file. */
function fakeSftpClient() {
  return {
    sftp: (cb: (err: Error | null, sftp: unknown) => void) =>
      cb(null, { stat: sftpStatMock }),
    end: vi.fn(),
  };
}

function localItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "media-1",
    name: "photo.png",
    mimeType: "image/png",
    relativePath: "pics/photo.png",
    updatedAt: new Date("2026-08-27T00:00:00.000Z"),
    storageNode: { id: "node-local", driver: "LOCAL", basePath: tempRoot },
    ...overrides,
  };
}

function remoteItem(id: string) {
  return {
    id,
    name: `${id}.png`,
    mimeType: "image/png",
    relativePath: `pics/${id}.png`,
    updatedAt: new Date("2026-08-27T00:00:00.000Z"),
    storageNode: {
      id: "node-sftp",
      driver: "SFTP",
      basePath: "/srv/data",
      host: "10.0.0.9",
      port: 22,
      username: "root",
      password: "pw",
    },
  };
}

const { GET } = await import("../route");

function call(id = "media-1") {
  return GET(new Request(`http://local/api/media/${id}/thumbnail`), {
    params: Promise.resolve({ id }),
  });
}

describe("media thumbnail route", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "vch-thumb-src-"));
    cacheRoot = await mkdtemp(path.join(os.tmpdir(), "vch-thumb-cache-"));
    process.env.MEDIA_THUMB_CACHE_DIR = cacheRoot;
    await mkdir(path.join(tempRoot, "pics"), { recursive: true });
    const sharp = (await import("sharp")).default;
    await writeFile(
      path.join(tempRoot, "pics", "photo.png"),
      await sharp({
        create: { width: 800, height: 600, channels: 3, background: "#336699" },
      })
        .png()
        .toBuffer(),
    );
    assertStorageAccessMock.mockResolvedValue({ allowed: true });
    getMediaItemMock.mockResolvedValue(localItem());
    connectSshMock.mockResolvedValue(fakeSftpClient());
    sftpStatMock.mockImplementation(
      (_p: string, cb: (err: Error | null) => void) => cb(new Error("No such file")),
    );
  });

  afterEach(async () => {
    delete process.env.MEDIA_THUMB_CACHE_DIR;
    await rm(tempRoot, { recursive: true, force: true });
    await rm(cacheRoot, { recursive: true, force: true });
  });

  it("renders a JPEG thumbnail and serves the second request from cache", async () => {
    const first = await call();
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("image/jpeg");
    expect(first.headers.get("x-thumbnail-cache")).toBe("miss");

    const second = await call();
    expect(second.headers.get("x-thumbnail-cache")).toBe("hit");
  });

  it("refuses a media type it cannot render", async () => {
    getMediaItemMock.mockResolvedValue(localItem({ mimeType: "video/mp4" }));
    expect((await call()).status).toBe(415);
  });

  it("returns 403 with localized copy after a single ACL check when storage access is denied", async () => {
    assertStorageAccessMock.mockResolvedValue({ allowed: false, reason: "no_access" });
    const response = await call();
    expect(response.status).toBe(403);
    // Denial codes render localized copy — never the raw code or English prose.
    expect(await response.json()).toMatchObject({
      error: "没有此存储节点或路径的访问授权",
    });
    expect(assertStorageAccessMock).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for a media item outside the caller's scope", async () => {
    getMediaItemMock.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });

  it("keeps trying a reachable node after a single unreadable file", async () => {
    // One missing file must not open the circuit breaker: the handshake proved
    // the host is alive, so the next tile on that node still gets a chance.
    getMediaItemMock.mockResolvedValue(remoteItem("media-a"));
    const first = await call("media-a");
    expect(first.headers.get("x-thumbnail-placeholder")).toBe("offline");

    getMediaItemMock.mockResolvedValue(remoteItem("media-b"));
    const second = await call("media-b");
    expect(second.headers.get("x-thumbnail-placeholder")).toBe("offline");
    expect(connectSshMock).toHaveBeenCalledTimes(2);
    // Regression: the SFTP branch used to run a SECOND full ACL check after
    // path normalization — one authorization per request is the contract.
    expect(assertStorageAccessMock).toHaveBeenCalledTimes(2);
  });

  it("never lets a shared cache hold a placeholder for an authenticated media URL", async () => {
    getMediaItemMock.mockResolvedValue(remoteItem("media-cache"));
    const response = await call("media-cache");

    expect(response.headers.get("x-thumbnail-placeholder")).toBe("offline");
    const cacheControl = response.headers.get("cache-control") ?? "";
    // `public` would let a proxy serve this per-media URL to another viewer, and
    // a long max-age would pin a transient node outage for everyone.
    expect(cacheControl).toContain("private");
    expect(cacheControl).not.toContain("public");
    const maxAge = Number(/max-age=(\d+)/.exec(cacheControl)?.[1] ?? -1);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(30);
  });

  it("opens the breaker when the node itself cannot be reached", async () => {
    connectSshMock.mockRejectedValue(new Error("ETIMEDOUT"));
    getMediaItemMock.mockResolvedValue(remoteItem("media-c"));
    expect((await call("media-c")).headers.get("x-thumbnail-placeholder")).toBe("offline");

    getMediaItemMock.mockResolvedValue(remoteItem("media-d"));
    expect((await call("media-d")).headers.get("x-thumbnail-placeholder")).toBe("offline");
    // Short-circuited by the cooldown — no second connection attempt.
    expect(connectSshMock).toHaveBeenCalledTimes(1);
  });
});
