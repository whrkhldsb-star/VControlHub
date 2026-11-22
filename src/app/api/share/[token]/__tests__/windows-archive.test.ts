import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ streamRemoteTarGz: vi.fn(), connect: vi.fn() }));

vi.mock("@/lib/storage/archive-access", () => ({
  openManagedArchive: async ({ open }: { open: (excluded: string[]) => unknown }) => open(["docs/old notes.txt"]),
}));
vi.mock("@/lib/storage/archive-stream", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/archive-stream")>()),
  streamRemoteTarGz: mocks.streamRemoteTarGz,
}));
vi.mock("@/lib/ssh/client", () => ({ connectSsh: mocks.connect, readRemoteFile: vi.fn() }));
vi.mock("@/lib/storage/remote-containment", () => ({ assertRemotePathContained: async (_c: unknown, _b: string, p: string) => p }));
vi.mock("@/lib/storage/ssh-credentials", () => ({
  resolveStorageSshCredentials: () => ({ host: "198.51.100.7", port: 22, username: "win", password: "secret", connectionType: "PASSWORD" }),
}));
vi.mock("@/lib/storage/file-overwrite-lock", () => ({ lockStorageFileOverwrite: async () => async () => {} }));
vi.mock("@/lib/share-link/service", () => ({
  assertShareStillAt: vi.fn(), recordShareDownload: vi.fn(), shareIgnoresCase: () => true,
  authorizeShareDownload: vi.fn(),
  assertShareTargetNotDeleted: vi.fn(async () => undefined),
  hashShareToken: vi.fn((token: string) => `hash:${token}`),
  normalizeSharePath: vi.fn((value: string) => value.replace(/^\/+/, "")),
  releaseShareQuotaClaim: vi.fn(async () => undefined),
  resolveShareToken: vi.fn(),
}));

const { resolveShareToken } = await import("@/lib/share-link/service");
const route = await import("../route");

describe("public folder share archive on a Windows node", () => {
  it.each(["GET", "HEAD"] as const)("refuses a %s archive request before opening SSH", async (method) => {
    vi.mocked(resolveShareToken).mockResolvedValueOnce({
      id: "share_1",
      storageNode: { id: "node_1", name: "Windows", driver: "SFTP", basePath: "/C:/Shares", server: { operatingSystem: "WINDOWS" } },
      storageNodeId: "node_1",
      entryType: "DIRECTORY",
      path: "docs",
      name: "docs",
    } as never);

    const response = await route[method](new Request("http://local/api/share/token?archive=1"), {
      params: Promise.resolve({ token: "share-token-12345" }),
    });

    expect(response.status).toBe(400);
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.streamRemoteTarGz).not.toHaveBeenCalled();
  });
});
