import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), warn: vi.fn(),
  fileEntry: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
  transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { fileEntry: mocks.fileEntry, $transaction: mocks.transaction }, isUniqueViolation: () => false }));
vi.mock("@/lib/logging", () => ({ createLogger: () => ({ warn: mocks.warn }) }));
vi.mock("../webdav-client", () => ({ createWebDavClient: () => ({ list: mocks.list }) }));
import { syncWebDavDirectoryEntries } from "../webdav-sync";

const node = { id: "node-1", driver: "WEBDAV", basePath: "secret-root", webdavConfigEncrypted: "secret-config" };
const remote = (relativePath: string) => ({ relativePath, name: relativePath.split("/").at(-1)!, isDirectory: false, size: 3, lastModifiedMs: 0 });
const row = (id: string, relativePath: string, isDeleted = false) => ({ id, relativePath, isDeleted });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([]);
  mocks.fileEntry.findMany.mockResolvedValue([]);
  mocks.fileEntry.updateMany.mockResolvedValue({ count: 1 });
  mocks.fileEntry.deleteMany.mockResolvedValue({ count: 1 });
  mocks.fileEntry.createMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async (fn) => fn({ fileEntry: mocks.fileEntry }));
});

describe("WebDAV inventory sync", () => {
  const unchanged = (id: string, path: string) => ({ ...row(id, path), name: path.split("/").at(-1)!, entryType: "FILE", mimeType: "text/plain", size: BigInt(3) });

  it("counts unchanged entries as synced without writing or changing updatedAt", async () => {
    mocks.list.mockResolvedValue([remote("same.txt")]);
    mocks.fileEntry.findMany.mockResolvedValueOnce([unchanged("same", "same.txt")]);
    expect(await syncWebDavDirectoryEntries({ node })).toEqual({ synced: 1, created: 0, updated: 0, deleted: 0, errors: [] });
    expect(mocks.fileEntry.updateMany).not.toHaveBeenCalled();
  });

  it("does not re-read or update a fully inserted batch", async () => {
    mocks.list.mockResolvedValue([remote("new.txt")]);
    expect(await syncWebDavDirectoryEntries({ node })).toEqual({ synced: 1, created: 1, updated: 0, deleted: 0, errors: [] });
    expect(mocks.fileEntry.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.fileEntry.updateMany).not.toHaveBeenCalled();
  });

  it("does not rewrite inserted metadata when resolving partial batch conflicts", async () => {
    mocks.list.mockResolvedValue([remote("new.txt"), remote("raced.txt")]);
    mocks.fileEntry.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([unchanged("new", "new.txt"), { ...unchanged("raced", "raced.txt"), size: BigInt(1) }]);
    expect(await syncWebDavDirectoryEntries({ node })).toEqual({ synced: 2, created: 1, updated: 1, deleted: 0, errors: [] });
    expect(mocks.fileEntry.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.fileEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "raced", isDeleted: false } }));
  });

  it("reports retained missing indexes instead of silently claiming a clean inventory", async () => {
    mocks.fileEntry.findMany.mockResolvedValueOnce([row("protected", "private-secret.txt")]);
    mocks.fileEntry.deleteMany.mockResolvedValueOnce({ count: 0 });
    const result = await syncWebDavDirectoryEntries({ node });
    expect(result.deleted).toBe(0);
    expect(result.errors).toEqual(["Some remote-missing entries were retained to preserve file history or child indexes"]);
    expect(JSON.stringify(result)).not.toContain("private-secret");
    expect(mocks.fileEntry.updateMany).not.toHaveBeenCalled();
  });

  it("reads existing entries in batches and never resurrects tombstones", async () => {
    mocks.list.mockResolvedValue([remote("live.txt"), remote("trash.txt")]);
    mocks.fileEntry.findMany.mockResolvedValueOnce([row("live", "live.txt"), row("trash", "trash.txt", true)]);
    const result = await syncWebDavDirectoryEntries({ node });
    expect(result).toEqual({ synced: 1, created: 0, updated: 1, deleted: 0, errors: [] });
    expect(mocks.fileEntry.findFirst).not.toHaveBeenCalled();
    expect(mocks.fileEntry.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.fileEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "live", isDeleted: false } }));
    expect(mocks.fileEntry.createMany).not.toHaveBeenCalled();
  });

  it("removes only missing direct active indexes, allowing remote reappearance", async () => {
    mocks.fileEntry.findMany.mockResolvedValueOnce([row("gone", "dir/gone.txt"), row("child", "dir/sub/child.txt"), row("trash", "dir/trash.txt", true), row("self", "dir/")]);
    const result = await syncWebDavDirectoryEntries({ node, relativePath: "dir" });
    expect(result.deleted).toBe(1);
    expect(mocks.fileEntry.deleteMany).toHaveBeenCalledWith({ where: { storageNodeId: node.id, id: { in: ["gone"] }, isDeleted: false, versions: { none: {} }, children: { none: {} } } });
    expect(mocks.fileEntry.updateMany).not.toHaveBeenCalled();
    mocks.list.mockResolvedValue([remote("dir/gone.txt")]);
    mocks.fileEntry.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([row("new", "dir/gone.txt")]);
    const restored = await syncWebDavDirectoryEntries({ node, relativePath: "dir" });
    expect(restored).toEqual({ synced: 1, created: 1, updated: 0, deleted: 0, errors: [] });
  });

  it("uses bounded create and conflict reads, preserving a concurrently created tombstone", async () => {
    mocks.list.mockResolvedValue([remote("new.txt"), remote("raced.txt")]);
    mocks.fileEntry.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([unchanged("new", "new.txt"), row("raced", "raced.txt", true)]);
    const result = await syncWebDavDirectoryEntries({ node });
    expect(result).toEqual({ synced: 1, created: 1, updated: 0, deleted: 0, errors: [] });
    expect(mocks.fileEntry.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    expect(mocks.fileEntry.findFirst).not.toHaveBeenCalled();
    expect(mocks.fileEntry.updateMany).not.toHaveBeenCalled();
  });

  it("does not prune on remote failure and logs only safe structured context", async () => {
    mocks.list.mockRejectedValue(new Error("https://user:secret@example.org token=secret-config secret-root"));
    const result = await syncWebDavDirectoryEntries({ node, relativePath: "secret-path" });
    expect(result.errors).toHaveLength(1);
    expect(mocks.fileEntry.deleteMany).not.toHaveBeenCalled();
    expect(mocks.fileEntry.updateMany).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith("WebDAV directory sync failed", { storageNodeId: node.id, phase: "list" });
    expect(JSON.stringify([result, mocks.warn.mock.calls])).not.toContain("secret");
  });

  it("does not start pruning when an inventory write fails", async () => {
    mocks.list.mockResolvedValue([remote("live.txt")]);
    mocks.fileEntry.findMany.mockResolvedValueOnce([row("live", "live.txt"), row("gone", "gone.txt")]);
    mocks.fileEntry.updateMany.mockRejectedValue(new Error("secret"));
    const result = await syncWebDavDirectoryEntries({ node });
    expect(result.errors).toHaveLength(1);
    expect(mocks.fileEntry.deleteMany).not.toHaveBeenCalled();
    expect(result.synced).toBe(0);
  });

  it("uses a serializable transaction and discards success counters when commit fails", async () => {
    mocks.fileEntry.findMany.mockResolvedValueOnce([row("gone", "gone.txt")]);
    mocks.transaction.mockImplementation(async (fn) => { await fn({ fileEntry: mocks.fileEntry }); throw new Error("commit secret"); });
    const result = await syncWebDavDirectoryEntries({ node });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "Serializable" }));
    expect(result).toEqual({ synced: 0, created: 0, updated: 0, deleted: 0, errors: [expect.any(String)] });
  });

  it("paginates inventory before any pruning and aborts if a later page fails", async () => {
    mocks.fileEntry.findMany.mockResolvedValueOnce(Array.from({ length: 2000 }, (_, i) => row(`id-${i}`, `file-${i}`))).mockRejectedValueOnce(new Error("page failure"));
    const result = await syncWebDavDirectoryEntries({ node });
    expect(result.errors).toHaveLength(1);
    expect(mocks.fileEntry.deleteMany).not.toHaveBeenCalled();
    expect(mocks.fileEntry.updateMany).not.toHaveBeenCalled();
  });

  it("prunes in bounded batches only after the complete paginated read", async () => {
    mocks.fileEntry.findMany.mockResolvedValueOnce(Array.from({ length: 2000 }, (_, i) => row(`id-${i}`, `file-${i}`))).mockResolvedValueOnce([row("last", "last.txt")]);
    mocks.fileEntry.deleteMany.mockImplementation(async ({ where }) => ({ count: where.id.in.length }));
    const result = await syncWebDavDirectoryEntries({ node });
    expect(result.deleted).toBe(2001);
    expect(mocks.fileEntry.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: { id: "id-1999" }, skip: 1 }));
    expect(mocks.fileEntry.deleteMany).toHaveBeenCalledTimes(5);
    expect(mocks.fileEntry.deleteMany.mock.calls.every(([arg]) => arg.where.id.in.length <= 500)).toBe(true);
    expect(mocks.fileEntry.findMany.mock.invocationCallOrder[1]).toBeLessThan(mocks.fileEntry.deleteMany.mock.invocationCallOrder[0]!);
  });

  it("discards counters when a later prune batch fails", async () => {
    mocks.fileEntry.findMany.mockResolvedValueOnce(Array.from({ length: 501 }, (_, i) => row(`id-${i}`, `file-${i}`)));
    mocks.fileEntry.deleteMany.mockResolvedValueOnce({ count: 500 }).mockRejectedValueOnce(new Error("secret"));
    const result = await syncWebDavDirectoryEntries({ node });
    expect(result.deleted).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(mocks.warn).toHaveBeenCalledWith("WebDAV directory sync failed", { storageNodeId: node.id, phase: "index" });
  });

  it("deduplicates remote entries and maps directory metadata", async () => {
    const directory = { ...remote("folder"), isDirectory: true };
    mocks.list.mockResolvedValue([directory, directory]);
    mocks.fileEntry.findMany.mockResolvedValueOnce([row("folder-id", "folder")]);
    const result = await syncWebDavDirectoryEntries({ node });
    expect(result.synced).toBe(1);
    expect(mocks.fileEntry.updateMany).toHaveBeenCalledWith({ where: { id: "folder-id", isDeleted: false }, data: { name: "folder", entryType: "DIRECTORY", mimeType: "inode/directory", size: null } });
  });

  it("keeps a large unchanged inventory write-free across read pages", async () => {
    const rows = Array.from({ length: 2001 }, (_, i) => unchanged(`id-${i}`, `file-${i}.txt`));
    mocks.list.mockResolvedValue(rows.map((entry) => remote(entry.relativePath)));
    mocks.fileEntry.findMany.mockResolvedValueOnce(rows.slice(0, 2000)).mockResolvedValueOnce(rows.slice(2000));
    const result = await syncWebDavDirectoryEntries({ node });
    expect(result).toEqual({ synced: 2001, created: 0, updated: 0, deleted: 0, errors: [] });
    expect(mocks.fileEntry.updateMany).not.toHaveBeenCalled();
    expect(mocks.fileEntry.createMany).not.toHaveBeenCalled();
    expect(mocks.fileEntry.deleteMany).not.toHaveBeenCalled();
  });

  it("bounds fully new batches without conflict reads or follow-up writes", async () => {
    mocks.list.mockResolvedValue(Array.from({ length: 1001 }, (_, i) => remote(`new-${i}.txt`)));
    mocks.fileEntry.createMany.mockImplementation(async ({ data }) => ({ count: data.length }));
    const result = await syncWebDavDirectoryEntries({ node });
    expect(result).toEqual({ synced: 1001, created: 1001, updated: 0, deleted: 0, errors: [] });
    expect(mocks.fileEntry.createMany.mock.calls.map(([arg]) => arg.data.length)).toEqual([500, 500, 1]);
    expect(mocks.fileEntry.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.fileEntry.updateMany).not.toHaveBeenCalled();
  });

  it("rolls back reported inserts if a partial conflict cannot be resolved", async () => {
    mocks.list.mockResolvedValue([remote("new.txt"), remote("unresolved.txt")]);
    mocks.fileEntry.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([unchanged("new", "new.txt")]);
    const result = await syncWebDavDirectoryEntries({ node });
    expect(result).toEqual({ synced: 0, created: 0, updated: 0, deleted: 0, errors: [expect.any(String)] });
    expect(mocks.fileEntry.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects an invalid path without reading or modifying inventory", async () => {
    const result = await syncWebDavDirectoryEntries({ node, relativePath: "../outside" });
    expect(result.errors).toHaveLength(1);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
