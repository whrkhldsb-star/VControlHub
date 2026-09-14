import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SessionPayload } from "@/lib/auth/session";
import { closeSshPool } from "@/lib/ssh/client";

const mocks = vi.hoisted(() => ({
  first: vi.fn(),
  unique: vi.fn(),
  many: vi.fn(),
  upsert: vi.fn(),
  access: vi.fn(),
  releaseQuota: vi.fn(),
  releaseLock: vi.fn(),
  lock: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    fileEntry: {
      findFirst: mocks.first,
      findUnique: mocks.unique,
      findMany: mocks.many,
      upsert: mocks.upsert,
    },
  },
}));
vi.mock("@/lib/auth/team-scope", () => ({
  teamWhere: () => ({ teamId: "team" }),
}));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: mocks.access,
  releaseStorageQuotaGuard: mocks.releaseQuota,
}));
vi.mock("@/lib/concurrency/advisory-lock", () => ({
  tryAcquireAdvisoryLock: mocks.lock,
}));
vi.mock("@/lib/storage/file-versions", () => ({
  snapshotFileVersionBeforeOverwrite: mocks.snapshot,
}));
import { copyFileEntry, copyCandidateName } from "../copy-operation";
let root: string;
const session = { userId: "user", currentTeamId: "team" } as SessionPayload;
type Entry = {
  id: string;
  relativePath: string;
  name: string;
  entryType: "FILE" | "DIRECTORY";
  isDeleted: boolean;
  mimeType?: string;
};
let index: Map<string, Entry>;
beforeEach(async () => {
  vi.resetAllMocks();
  root = await mkdtemp(path.join(os.tmpdir(), "vch-copy-test-"));
  const source: Entry = {
    id: "source",
    relativePath: "source.txt",
    name: "source.txt",
    entryType: "FILE",
    isDeleted: false,
    mimeType: "text/plain",
  };
  index = new Map([[source.relativePath, source]]);
  mocks.first.mockResolvedValue({
    ...source,
    storageNodeId: "node",
    storageNode: { id: "node", driver: "LOCAL", basePath: root },
  });
  mocks.unique.mockImplementation(
    async ({ where }) =>
      index.get(where.storageNodeId_relativePath.relativePath) ?? null,
  );
  mocks.many.mockResolvedValue([]);
  mocks.upsert.mockImplementation(async ({ create, update }) => {
    const entry = {
      ...(index.get(create.relativePath) ?? {
        ...create,
        id: create.relativePath,
        isDeleted: false,
      }),
      ...update,
    };
    index.set(create.relativePath, entry);
    return entry;
  });
  mocks.access.mockResolvedValue({ allowed: true });
  mocks.lock.mockResolvedValue(mocks.releaseLock);
  await writeFile(path.join(root, "source.txt"), "source bytes");
  await mkdir(path.join(root, "destination"));
});
afterEach(async () => {
  await closeSshPool();
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(!process.env.VCH_TEST_SSH_CONFIG)("copyFileEntry over isolated OpenSSH SFTP", () => {
  it("preserves remote bytes across copy, rename conflict and overwrite", async () => {
    const server = JSON.parse(await readFile(process.env.VCH_TEST_SSH_CONFIG!, "utf8"));
    expect(server.host).toBe("127.0.0.1");
    expect(server.port).not.toBe(22);
    const source = await mocks.first();
    mocks.first.mockResolvedValue({ ...source, storageNode: { id: "node", driver: "SFTP", basePath: root, server } });
    const copied = await copy();
    expect(await readFile(path.join(root, copied.path), "utf8")).toBe("source bytes");
    const renamed = await copy();
    expect(renamed.path).toBe("destination/source (1).txt");
    expect((await copy("skip")).skipped).toBe(true);
    await writeFile(path.join(root, "source.txt"), "new remote bytes");
    await copy("overwrite");
    expect(await readFile(path.join(root, "destination/source.txt"), "utf8")).toBe("new remote bytes");
    expect(await readFile(path.join(root, renamed.path), "utf8")).toBe("source bytes");
    expect((await readdir(path.join(root, "destination"))).some((name) => name.startsWith(".vch-"))).toBe(false);
  }, 30000);
  it("keeps remote directory creation unconfirmed if indexing fails", async () => {
    const server = JSON.parse(await readFile(process.env.VCH_TEST_SSH_CONFIG!, "utf8"));
    expect(server.host).toBe("127.0.0.1");
    expect(server.port).not.toBe(22);
    await mkdir(path.join(root, "folder"));
    mocks.first.mockResolvedValue({id:"source",storageNodeId:"node",relativePath:"folder",name:"folder",entryType:"DIRECTORY",storageNode:{id:"node",driver:"SFTP",basePath:root,server}});
    mocks.upsert.mockRejectedValueOnce(new Error("database unavailable"));
    const { FileOperationUncertainError } = await import("../operation-schema");
    await expect(copy()).rejects.toBeInstanceOf(FileOperationUncertainError);
    expect(await readdir(path.join(root,"destination"))).toEqual(["folder"]);
    expect(index.has("destination/folder")).toBe(false);
  });
  it("copies remote nested files and empty directories", async () => {
    const server = JSON.parse(await readFile(process.env.VCH_TEST_SSH_CONFIG!, "utf8"));
    expect(server.host).toBe("127.0.0.1");
    expect(server.port).not.toBe(22);
    await mkdir(path.join(root, "folder/empty"), { recursive: true });
    await writeFile(path.join(root, "folder/proof.bin"), Buffer.from([0, 255, 128, 1]));
    mocks.first.mockResolvedValue({ id: "source", storageNodeId: "node", relativePath: "folder", name: "folder", entryType: "DIRECTORY", storageNode: { id: "node", driver: "SFTP", basePath: root, server } });
    expect((await copy()).copied).toBe(3);
    expect(await readFile(path.join(root, "destination/folder/proof.bin"))).toEqual(Buffer.from([0, 255, 128, 1]));
    expect(await readdir(path.join(root, "destination/folder/empty"))).toEqual([]);
  }, 30000);
});
const copy = (policy: "rename" | "skip" | "overwrite" = "rename") =>
  copyFileEntry({
    session,
    fileEntryId: "source",
    targetDir: "destination",
    policy,
  });

describe("copyFileEntry with real local files", () => {
  it("revalidates the source after acquiring the operation lock", async () => {
    const source = await mocks.first();
    mocks.first
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce({ ...source, relativePath: "moved.txt" });
    await expect(copy()).rejects.toThrow("changed");
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(await readdir(path.join(root, "destination"))).toEqual([]);
  });
  it("copies bytes and creates an independent indexed entry", async () => {
    const result = await copy();
    expect(result).toMatchObject({ path: "destination/source.txt", copied: 1 });
    expect(await readFile(path.join(root, result.path), "utf8")).toBe(
      "source bytes",
    );
    expect(await readFile(path.join(root, "source.txt"), "utf8")).toBe(
      "source bytes",
    );
    expect(index.has(result.path)).toBe(true);
    expect(mocks.releaseLock).toHaveBeenCalledOnce();
    expect(mocks.releaseQuota).toHaveBeenCalledOnce();
  });
  it.each(["skip", "rename"] as const)(
    "honors %s for an unindexed physical conflict",
    async (policy) => {
      await writeFile(path.join(root, "destination/source.txt"), "keep me");
      const result = await copy(policy);
      expect(
        await readFile(path.join(root, "destination/source.txt"), "utf8"),
      ).toBe("keep me");
      expect(result.skipped).toBe(policy === "skip");
      if (policy === "rename")
        expect(
          await readFile(path.join(root, "destination/source (1).txt"), "utf8"),
        ).toBe("source bytes");
    },
  );
  it("restores the overwritten file when its metadata commit fails", async () => {
    await writeFile(path.join(root, "destination/source.txt"), "old bytes");
    mocks.upsert.mockRejectedValue(new Error("database offline"));
    await expect(copy("overwrite")).rejects.toThrow("database offline");
    expect(
      await readFile(path.join(root, "destination/source.txt"), "utf8"),
    ).toBe("old bytes");
    expect(await readdir(path.join(root, "destination"))).toEqual([
      "source.txt",
    ]);
  });
  it("refuses overwrite of recycle-bin files", async () => {
    index.set("destination/source.txt", {
      id: "trash",
      name: "source.txt",
      relativePath: "destination/source.txt",
      entryType: "FILE",
      isDeleted: true,
    });
    await expect(copy("overwrite")).rejects.toThrow("recycle bin");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("copies nested files and empty directories, excluding recycled descendants", async () => {
    await mkdir(path.join(root, "folder/empty"), { recursive: true });
    await writeFile(path.join(root, "folder/child.txt"), "child");
    await writeFile(path.join(root, "folder/deleted.txt"), "trash");
    mocks.first.mockResolvedValue({
      id: "source",
      storageNodeId: "node",
      relativePath: "folder",
      name: "folder",
      entryType: "DIRECTORY",
      storageNode: { id: "node", driver: "LOCAL", basePath: root },
    });
    mocks.many.mockResolvedValue([{ relativePath: "folder/deleted.txt" }]);
    const result = await copy();
    expect(result.copied).toBe(3);
    expect(await readdir(path.join(root, "destination/folder"))).toEqual([
      "child.txt",
      "empty",
    ]);
    expect(
      await readFile(path.join(root, "destination/folder/child.txt"), "utf8"),
    ).toBe("child");
  });
  it("checks descendant ACL before creating the destination directory", async () => {
    await mkdir(path.join(root, "folder"));
    await writeFile(path.join(root, "folder/private.txt"), "private");
    mocks.first.mockResolvedValue({
      id: "source",
      storageNodeId: "node",
      relativePath: "folder",
      name: "folder",
      entryType: "DIRECTORY",
      storageNode: { id: "node", driver: "LOCAL", basePath: root },
    });
    mocks.access.mockImplementation(async ({ relativePath }) => ({
      allowed: relativePath !== "folder/private.txt",
      reason: "denied",
    }));
    await expect(copy()).rejects.toThrow("denied");
    expect(await readdir(path.join(root, "destination"))).toEqual([]);
  });
  it("refuses symbolic links during recursive copy", async () => {
    await mkdir(path.join(root, "folder"));
    await symlink(
      path.join(root, "source.txt"),
      path.join(root, "folder/link"),
    );
    mocks.first.mockResolvedValue({
      id: "source",
      storageNodeId: "node",
      relativePath: "folder",
      name: "folder",
      entryType: "DIRECTORY",
      storageNode: { id: "node", driver: "LOCAL", basePath: root },
    });
    await expect(copy()).rejects.toThrow("special file");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("blocks nested destinations and honors cancellation before writes", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      copyFileEntry({
        session,
        fileEntryId: "source",
        targetDir: "destination",
        policy: "rename",
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(copyCandidateName("archive.tar.gz", 2, false)).toBe(
      "archive.tar (2).gz",
    );
    expect(copyCandidateName("folder.name", 2, true)).toBe("folder.name (2)");
  });
});

// Regression: preserve the filesystem/index invariant on failed directory copy.
it("directory metadata failure must roll back created root or be unconfirmed", async () => {
  await mkdir(path.join(root, "folder"));
  mocks.first.mockResolvedValue({ id: "source", storageNodeId: "node", relativePath: "folder", name: "folder", entryType: "DIRECTORY", storageNode: { id: "node", driver: "LOCAL", basePath: root } });
  mocks.upsert.mockRejectedValueOnce(new Error("database offline"));
  const { FileOperationUncertainError } = await import("../operation-schema");
  let failure: unknown;
  try { await copy(); } catch (error) { failure = error; }
  const remaining = await readdir(path.join(root, "destination"));
  expect(remaining.length === 0 || failure instanceof FileOperationUncertainError).toBe(true);
});

it.each(["contents", "index"])("preserves a newly created directory when %s prevents safe compensation", async (conflict) => {
  await mkdir(path.join(root, "folder"));
  mocks.first.mockResolvedValue({ id: "source", storageNodeId: "node", relativePath: "folder", name: "folder", entryType: "DIRECTORY", storageNode: { id: "node", driver: "LOCAL", basePath: root } });
  mocks.upsert.mockImplementationOnce(async () => {
    if (conflict === "contents") await writeFile(path.join(root, "destination/folder/new.txt"), "preserve");
    else index.set("destination/folder", {id:"committed", relativePath:"destination/folder",name:"folder",entryType:"DIRECTORY",isDeleted:false});
    throw new Error("database response lost");
  });
  const { FileOperationUncertainError } = await import("../operation-schema");
  await expect(copy()).rejects.toBeInstanceOf(FileOperationUncertainError);
  expect(await readdir(path.join(root, "destination"))).toContain("folder");
  if (conflict === "contents") expect(await readFile(path.join(root, "destination/folder/new.txt"), "utf8")).toBe("preserve");
});
