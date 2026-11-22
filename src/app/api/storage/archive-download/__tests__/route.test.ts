vi.mock("@/lib/concurrency/advisory-lock", () => ({tryAcquireAdvisoryLock: async () => async () => {}}));
import path from "node:path";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { localStorageStagingPatterns, storageStagingPatterns } from "@/lib/storage/staging-paths";
import { resolveLocalTarBinary } from "@/lib/runtime/tar-binary";

const {
  assertStorageAccessMock,
  prismaMock,
  spawnMock,
  statMock,
  pinLocalArchiveDirectoryMock,
  connectMock,
  execMock,
  endMock,
} = vi.hoisted(() => ({
  assertStorageAccessMock: vi.fn<(...args: unknown[]) => Promise<{ allowed: boolean; reason?: string }>>(
    () => Promise.resolve({ allowed: true }),
  ),
  prismaMock: {
    fileEntry: {
      findFirst: vi.fn(),
      findMany: vi.fn(async () => []),
    },
  },
  spawnMock: vi.fn(),
  statMock: vi.fn(),
  pinLocalArchiveDirectoryMock: vi.fn(),
  connectMock: vi.fn(),
  execMock: vi.fn(),
  endMock: vi.fn(),
}));

vi.mock("@/lib/storage/open-local-file", () => ({
  pinLocalArchiveDirectory: pinLocalArchiveDirectoryMock,
}));

vi.mock("node:child_process", () => ({
  default: { spawn: spawnMock },
  spawn: spawnMock,
}));

vi.mock("node:fs/promises", () => ({
  default: { stat: statMock },
  stat: statMock,
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: vi.fn(async (_request, _options, handler) => {
    try {
      return await handler({ session: { userId: "u_1", username: "admin", roles: ["admin"] } });
    } catch (e) {
      const { apiCatch } = await import("@/lib/http/api-error");
      return apiCatch(e);
    }
  }),
}));

vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: assertStorageAccessMock,
  releaseStorageQuotaGuard: vi.fn(async () => undefined),
}));

vi.mock("@/lib/ssh/ssh-key-crypto", async () => (await import("@/test/ssh-key-crypto-mock")).withStoredKeyHelpers({
  decryptServerPassword: (value: string) => value,
  decryptSshPrivateKey: (value: string) => value,
}));

// No symlinks on the mocked host: physical path == lexical path.
vi.mock("@/lib/ssh/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ssh/client")>()),
  resolveRemoteRealPath: vi.fn(async ({ remotePath }: { remotePath: string }) => remotePath),
}));
vi.mock("ssh2", () => ({
  Client: class ClientMock {
    on(event: string, callback: (...args: unknown[]) => void) {
      if (event === "ready") connectMock.mockImplementationOnce(() => callback());
      return this;
    }
    connect(config: unknown) {
      connectMock(config);
    }
    // The shared SSH client now caps listeners on the client instance.
    setMaxListeners(_max: number) {
      return this;
    }
    exec(command: string, callback: (err: Error | null, stream: PassThrough & { stderr: PassThrough }) => void) {
      execMock(command);
      const stream = new PassThrough({ autoDestroy: false }) as PassThrough & { stderr: PassThrough };
      stream.stderr = new PassThrough();
      callback(null, stream);
      stream.end("archive", () => stream.emit("close", 0));
    }
    end() {
      endMock();
    }
  },
}));

import { GET } from "../route";

function localDirectoryEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "dir_1",
    name: "photos",
    relativePath: "photos",
    entryType: "DIRECTORY",
    mimeType: "inode/directory",
    storageNode: {
      id: "node_1",
      name: "Local",
      driver: "LOCAL",
      basePath: "/srv/storage",
      host: null,
      port: null,
      username: null,
      server: null,
    },
    ...overrides,
  };
}

describe("/api/storage/archive-download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertStorageAccessMock.mockResolvedValue({ allowed: true });
    statMock.mockResolvedValue({ isDirectory: () => true });
    pinLocalArchiveDirectoryMock.mockResolvedValue({
      fd: 3,
      cwd: undefined,
      close: vi.fn(async () => undefined),
    });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    spawnMock.mockReturnValue({ stdout, stderr, on: vi.fn(), kill: vi.fn(), killed: false, pid: 4242 });
    queueMicrotask(() => stdout.end("archive"));
  });

  const hiddenStages = storageStagingPatterns.map(pattern => `--exclude=${pattern}`);

  it("streams a local directory as a tar.gz archive", async () => {
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(localDirectoryEntry());

    const response = await GET(
      new Request("https://example.com/api/storage/archive-download?nodeId=node_1&path=photos"),
    );

    expect(response.status).toBe(200);
    expect(assertStorageAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ storageNodeId: "node_1", relativePath: "photos", operation: "read" }),
    );
    expect(pinLocalArchiveDirectoryMock).toHaveBeenCalledWith("/srv/storage", "photos");
    expect(spawnMock).toHaveBeenCalledWith(
      resolveLocalTarBinary(),
      expect.arrayContaining(["-czf", "-", ...localStorageStagingPatterns.map(pattern => `--exclude=${pattern}`)]),
      expect.objectContaining({ stdio: expect.arrayContaining([3]) }),
    );
    expect(response.headers.get("content-disposition")).toContain("photos.tar.gz");
  });

  it("rejects non-directory entries before spawning tar", async () => {
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(localDirectoryEntry({ entryType: "FILE", mimeType: "text/plain" }));

    const response = await GET(
      new Request("https://example.com/api/storage/archive-download?nodeId=node_1&path=photos"),
    );

    expect(response.status).toBe(400);
    expect(spawnMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ error: "Target is not a directory" });
  });

  it("rejects denied read access before touching local disk", async () => {
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(localDirectoryEntry());
    assertStorageAccessMock.mockResolvedValueOnce({ allowed: false, reason: "no_access" } as unknown as never);

    const response = await GET(
      new Request("https://example.com/api/storage/archive-download?nodeId=node_1&path=photos"),
    );

    expect(response.status).toBe(403);
    expect(statMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
    // Denial codes render localized copy via storageAccessDeniedCopy.
    await expect(response.json()).resolves.toMatchObject({ error: "没有此存储节点或路径的访问授权" });
  });

  it("rejects unsafe directory paths before lookup or side effects", async () => {
    const response = await GET(
      new Request("https://example.com/api/storage/archive-download?nodeId=node_1&path=../photos"),
    );

    expect(response.status).toBe(400);
    expect(prismaMock.fileEntry.findFirst).not.toHaveBeenCalled();
    expect(assertStorageAccessMock).not.toHaveBeenCalled();
    expect(statMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("streams an SFTP directory through remote tar over SSH", async () => {
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(
      localDirectoryEntry({
        storageNode: {
          teamId: null,
          id: "node_sftp",
          name: "Remote",
          driver: "SFTP",
          basePath: "/data/files",
          host: null,
          port: null,
          username: null,
          hostKeySha256: "aa".repeat(32),
          server: {
            teamId: null,
            operatingSystem: "LINUX",
            host: "203.0.113.20",
            port: 2222,
            username: "deploy",
            connectionType: "PASSWORD",
            password: "secret",
            hostKeySha256: "bb".repeat(32),
            sshKey: null,
          },
        },
      }),
    );

    const response = await GET(
      new Request("https://example.com/api/storage/archive-download?nodeId=node_sftp&path=photos"),
    );

    expect(response.status).toBe(200);
    // connectSsh maps hostKeySha256 pin → hostHash/hostVerifier (not raw field)
    expect(connectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "203.0.113.20",
        port: 2222,
        hostHash: "sha256",
        hostVerifier: expect.any(Function),
      }),
    );
    expect(execMock).toHaveBeenCalledWith(`tar -czf - -C '/data/files' ${hiddenStages.map(flag => `'${flag}'`).join(" ")} -- 'photos'`);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("team-scopes directory entry lookup via storageNode teamWhere", async () => {
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(null);

    const response = await GET(
      new Request("https://example.com/api/storage/archive-download?nodeId=node_other&path=photos"),
    );

    expect(response.status).toBe(404);
    expect(prismaMock.fileEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storageNodeId: "node_other",
          storageNode: expect.any(Object),
        }),
        include: expect.objectContaining({
          storageNode: expect.objectContaining({
            select: expect.objectContaining({
              hostKeySha256: true,
              server: expect.objectContaining({
                select: expect.objectContaining({
                  hostKeySha256: true,
                }),
              }),
            }),
          }),
        }),
      }),
    );
    expect(statMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
  });
});
