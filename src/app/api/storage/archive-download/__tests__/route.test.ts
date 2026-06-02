import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  assertStorageAccessMock,
  prismaMock,
  spawnMock,
  statMock,
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
    },
  },
  spawnMock: vi.fn(),
  statMock: vi.fn(),
  connectMock: vi.fn(),
  execMock: vi.fn(),
  endMock: vi.fn(),
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
  withApiRoute: vi.fn(async (_request, _options, handler) =>
    handler({ session: { userId: "u_1", username: "admin", roles: ["admin"] } }),
  ),
}));

vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: assertStorageAccessMock,
}));

vi.mock("@/lib/ssh/ssh-key-crypto", () => ({
  decryptServerPassword: (value: string) => value,
  decryptSshPrivateKey: (value: string) => value,
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
    exec(command: string, callback: (err: Error | null, stream: PassThrough & { stderr: PassThrough }) => void) {
      execMock(command);
      const stream = new PassThrough() as PassThrough & { stderr: PassThrough };
      stream.stderr = new PassThrough();
      callback(null, stream);
      stream.end("archive");
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
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    spawnMock.mockReturnValue({ stdout, stderr });
    queueMicrotask(() => stdout.end("archive"));
  });

  it("streams a local directory as a tar.gz archive", async () => {
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(localDirectoryEntry());

    const response = await GET(
      new Request("https://example.com/api/storage/archive-download?nodeId=node_1&path=photos"),
    );

    expect(response.status).toBe(200);
    expect(assertStorageAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ storageNodeId: "node_1", relativePath: "photos", operation: "read" }),
    );
    expect(statMock).toHaveBeenCalledWith("/srv/storage/photos");
    expect(spawnMock).toHaveBeenCalledWith("tar", ["-czf", "-", "-C", "/srv/storage", "--", "photos"], expect.any(Object));
    expect(response.headers.get("content-disposition")).toContain("photos.tar.gz");
  });

  it("rejects non-directory entries before spawning tar", async () => {
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(localDirectoryEntry({ entryType: "FILE", mimeType: "text/plain" }));

    const response = await GET(
      new Request("https://example.com/api/storage/archive-download?nodeId=node_1&path=photos"),
    );

    expect(response.status).toBe(400);
    expect(spawnMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ error: "目标不是目录" });
  });

  it("rejects denied read access before touching local disk", async () => {
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(localDirectoryEntry());
    assertStorageAccessMock.mockResolvedValueOnce({ allowed: false, reason: "forbidden" } as unknown as never);

    const response = await GET(
      new Request("https://example.com/api/storage/archive-download?nodeId=node_1&path=photos"),
    );

    expect(response.status).toBe(403);
    expect(statMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ error: "forbidden" });
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
          id: "node_sftp",
          name: "Remote",
          driver: "SFTP",
          basePath: "/data/files",
          host: null,
          port: null,
          username: null,
          server: {
            host: "203.0.113.20",
            port: 2222,
            username: "deploy",
            connectionType: "PASSWORD",
            password: "secret",
            sshKey: null,
          },
        },
      }),
    );

    const response = await GET(
      new Request("https://example.com/api/storage/archive-download?nodeId=node_sftp&path=photos"),
    );

    expect(response.status).toBe(200);
    expect(connectMock).toHaveBeenCalledWith(expect.objectContaining({ host: "203.0.113.20", port: 2222 }));
    expect(execMock).toHaveBeenCalledWith("tar -czf - -C '/data/files' -- 'photos'");
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
