import { Readable } from "node:stream";
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
vi.mock("@/lib/share-link/service", () => ({
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
  it("builds the archive with bsdtar argv exclusions, as the signed-in download does", async () => {
    mocks.connect.mockResolvedValue({ end: vi.fn() });
    mocks.streamRemoteTarGz.mockResolvedValue(Readable.from([Buffer.from([0x1f, 0x8b])]));
    vi.mocked(resolveShareToken).mockResolvedValueOnce({
      id: "share_1",
      storageNode: { id: "node_1", name: "Windows", driver: "SFTP", basePath: "/C:/Shares", server: { operatingSystem: "WINDOWS" } },
      storageNodeId: "node_1",
      entryType: "DIRECTORY",
      path: "docs",
      name: "docs",
    } as never);

    const response = await route.GET(new Request("http://local/api/share/token?archive=1"), {
      params: Promise.resolve({ token: "share-token-12345" }),
    });

    expect(response.status).toBe(200);
    // Without the option, GNU-only --exclude-from=- reached Windows tar.
    expect(mocks.streamRemoteTarGz).toHaveBeenCalledWith(expect.anything(), "/C:/Shares/docs", ["docs/old notes.txt"], { bsdtar: true });
  });
});
