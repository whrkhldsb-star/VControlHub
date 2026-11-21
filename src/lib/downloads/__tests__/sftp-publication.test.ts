// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeAria2RelayDownload } from "../execution";

const mocks = vi.hoisted(() => ({
  readNode: vi.fn(), run: vi.fn(), open: vi.fn(), index: vi.fn(), receive: vi.fn(),
}));
vi.mock("../agent-relay", () => ({ receiveAgentHttpDownload: mocks.receive }));
vi.mock("@/lib/db", () => ({
  prisma: {
    storageNode: { findFirst: mocks.readNode },
    downloadTask: { findFirstOrThrow: vi.fn(async () => ({ createdBy: "user", teamId: "team" })) },
    $transaction: (body: (tx: unknown) => Promise<void>) => body({
      $queryRaw: vi.fn(async () => [{ id: "node" }]), storageNode: { findFirst: mocks.readNode },
    }),
  },
}));
vi.mock("@/lib/downloads/helpers", async importOriginal => ({
  ...await importOriginal<typeof import("../helpers")>(), indexDownloadedFileEntry: mocks.index,
}));
vi.mock("@/lib/auth/execution-actor", () => ({
  loadExecutionActor: vi.fn(async () => ({ userId: "user" })), executionRefusal: vi.fn(async () => null),
}));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: vi.fn(async () => ({ allowed: true })), releaseStorageQuotaGuard: vi.fn(),
}));
vi.mock("@/lib/storage/archive-access", () => ({ assertNotRecycled: vi.fn() }));
vi.mock("@/lib/storage/file-overwrite-lock", () => ({ lockStorageFileOverwrite: vi.fn(async () => () => {}) }));
vi.mock("@/lib/ssh/client", () => ({
  execRemoteCommand: mocks.run, connectSsh: mocks.open, createVerifiedSshConfig: vi.fn(),
  buildSshParamsFromServer: vi.fn(async () => ({})),
  resolveRemoteRealPath: vi.fn(async ({ remotePath }) => remotePath),
}));

const server = {
  id: "server", teamId: "team", managementMode: "DIRECT", operatingSystem: "LINUX",
  host: "files.example", port: 22, username: "files", hostKeySha256: "pin",
  connectionType: "PASSWORD", password: "test-password", sshKeyId: null, sshKey: null,
  storageNode: { id: "node", basePath: "/drive" },
};
const currentNode = {
  teamId: "team", basePath: "/drive", host: null, port: null, username: null, hostKeySha256: null, server,
};

describe("SFTP relay publication", () => {
  let temp: string;
  beforeEach(async () => {
    vi.clearAllMocks();
    temp = await mkdtemp(join(tmpdir(), "vch-sftp-relay-"));
    const file = join(temp, "body");
    await writeFile(file, "a");
    mocks.receive.mockImplementation(({ publishSftp }) =>
      publishSftp(file, { name: "file.bin", size: 1, sha256: "a".repeat(64) }));
    mocks.readNode.mockResolvedValue(currentNode);
    mocks.run.mockResolvedValue({ exitCode: 0, stdout: "" });
    mocks.open.mockResolvedValue({
      end: vi.fn(),
      sftp: (cb: (error: null, client: unknown) => void) => cb(null, {
        createWriteStream: () => {
          const stream = new PassThrough();
          stream.resume();
          return stream;
        },
      }),
    });
  });
  afterEach(async () => { await rm(temp, { recursive: true, force: true }); });
  const publish = () => executeAria2RelayDownload("task", server, ["https://example.test/file"], "/drive",
    null, null, "user", undefined, undefined, true);

  it("refuses a moved root before creating a directory or staging a file", async () => {
    mocks.readNode.mockResolvedValueOnce({ ...currentNode, basePath: "/new" });
    await expect(publish()).rejects.toThrow();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.index).not.toHaveBeenCalled();
  });
  it.each([{ basePath: "/new" }, { port: 2200 }, { host: "other.example" }])(
    "refuses a binding changed during staging (%o) before rename and indexing", async changed => {
      mocks.readNode.mockResolvedValueOnce(currentNode).mockResolvedValueOnce({ ...currentNode, ...changed });
      await expect(publish()).rejects.toThrow();
      expect(mocks.open).toHaveBeenCalledOnce();
      expect(mocks.run.mock.calls.some(([arg]) => arg.command.includes("mv -fT"))).toBe(false);
      expect(mocks.index).not.toHaveBeenCalled();
    });
  it("renames and indexes a staged file under the verified binding", async () => {
    await publish();
    expect(mocks.run.mock.calls.some(([arg]) => arg.command.includes("mv -fT"))).toBe(true);
    expect(mocks.index).toHaveBeenCalledOnce();
  });
});
