// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeAria2RelayDownload } from "../execution";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  owner: vi.fn(), capacity: vi.fn(), refusal: vi.fn(async () => null as string | null), rename: vi.fn(), readNode: vi.fn(), run: vi.fn(), open: vi.fn(), index: vi.fn(), receive: vi.fn(),
}));
vi.mock("../agent-relay", () => ({ receiveAgentHttpDownload: mocks.receive }));
vi.mock("@/lib/db", () => ({
  prisma: {
    storageNode: { findFirst: mocks.readNode },
    downloadTask: { findFirstOrThrow: vi.fn(async () => ({ createdBy: "user", teamId: "team" })) },
    $transaction: (body: (tx: unknown) => Promise<void>) => body({
      $queryRaw: mocks.query, server: { findFirst: vi.fn(async () => ({ id: "server" })) }, downloadTask: { count: vi.fn(async () => 1) }, storageNode: { findFirst: mocks.readNode },
    }),
  },
}));
vi.mock("@/lib/downloads/helpers", async importOriginal => ({
  ...await importOriginal<typeof import("../helpers")>(), indexDownloadedFileEntry: mocks.index,
}));
vi.mock("@/lib/auth/execution-actor", () => ({
  loadExecutionActor: vi.fn(async () => ({ userId: "user" })), executionRefusal: mocks.refusal,
}));
vi.mock("@/lib/api-token/authorization", () => ({ loadJobOwnerSession: mocks.owner }));
vi.mock("../write-capacity", () => ({ downloadWriteCapacity: mocks.capacity }));
vi.mock("../publication-lock", () => ({ lockDownloadPublication: vi.fn(async () => () => {}) }));
vi.mock("../pinned-publication", () => ({ publishPinnedFile: mocks.open }));
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
    mocks.query.mockResolvedValue([{ id: "node" }]);
    temp = await mkdtemp(join(tmpdir(), "vch-sftp-relay-"));
    const file = join(temp, "body");
    await writeFile(file, "a");
    mocks.receive.mockImplementation(({ publishSftp }) =>
      publishSftp(file, { name: "file.bin", size: 1, sha256: "a".repeat(64) }));
    mocks.owner.mockResolvedValue({ userId: "user", roles: ["operator"], currentTeamId: "team", permissions: ["storage:write"] });
    mocks.capacity.mockResolvedValue({ remainingBytes: null, maxFileBytes: null });
    mocks.readNode.mockResolvedValue(currentNode);
    mocks.run.mockResolvedValue({ exitCode: 0, stdout: "" });
    mocks.open.mockImplementation(async (_ssh, _remote, _prefix, _digest, _local, commit) => commit(mocks.rename));
  });
  afterEach(async () => { await rm(temp, { recursive: true, force: true }); });
  const publish = () => executeAria2RelayDownload("task", server, ["https://example.test/file"], "/drive",
    null, null, "user", undefined, undefined, true, { id: "job", workerId: "worker", attempts: 2 });

  it("rejects a replaced job claim before acknowledging the remote rename", async () => {
    mocks.query.mockResolvedValueOnce([]);
    await expect(publish()).rejects.toThrow();
    expect(mocks.query.mock.calls[0]!.slice(1, 4)).toEqual(["job", "worker", 2]);
    expect(mocks.rename).not.toHaveBeenCalled();
  });

  it.each([false, true])("recovers only the journaled staged generation (intervening writer=%s)", async changed => {
    mocks.receive.mockImplementation(({ publishSftp }) => publishSftp("fixture", { name: "file.bin", size: 1, sha256: "a".repeat(64), publication: { original: "before", staged: "ours" } }));
    mocks.open.mockImplementation(async (_ssh, _remote, _prefix, _digest, _local, commit) => commit(mocks.rename, { original: "after", staged: changed ? "theirs" : "ours", matches: true }));
    if (changed) {
      await expect(publish()).rejects.toMatchObject({ status: 409 });
      expect(mocks.rename).not.toHaveBeenCalled();
    } else {
      await publish();
      expect(mocks.index).toHaveBeenCalledOnce();
    }
  });

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
      expect(mocks.rename).not.toHaveBeenCalled();
      expect(mocks.index).not.toHaveBeenCalled();
    });
  it("rechecks the creator and write grant after staging", async () => {
    mocks.capacity.mockResolvedValueOnce({ denied: true, remainingBytes: BigInt(0), maxFileBytes: BigInt(0) });
    await expect(publish()).rejects.toThrow();
    expect(mocks.open).toHaveBeenCalledOnce();
    expect(mocks.rename).not.toHaveBeenCalled();
    expect(mocks.index).not.toHaveBeenCalled();
  });
  it("renames and indexes a staged file under the verified binding", async () => {
    await publish();
    expect(mocks.rename).toHaveBeenCalledOnce();
    expect(mocks.index).toHaveBeenCalledOnce();
  });
});
