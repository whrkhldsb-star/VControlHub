import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), findMany: vi.fn(), transaction: vi.fn(), update: vi.fn(), stat: vi.fn(), ssh: vi.fn(), agent: vi.fn() }));
vi.mock("@/lib/storage/file-overwrite-lock", () => ({ lockStorageFileOverwrite: async () => async () => {} }));
vi.mock("@/lib/storage/access-control", () => ({ assertStorageAccess: async () => ({ allowed: true }), releaseStorageQuotaGuard: async () => {}, getStorageAccessCapabilityKey: () => "child", getStorageAccessCapabilities: async () => new Map([["child", { canDelete: true }]]) }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: mocks.transaction, fileEntry: { findFirst: mocks.findFirst, findMany: mocks.findMany, update: mocks.update } }, isUniqueViolation: () => false }));
vi.mock("@/lib/storage/agent-file-queue", () => ({ getFileChannel: vi.fn(), callFileAgent: mocks.agent }));
vi.mock("@/lib/storage/webdav-client", () => ({ createWebDavClient: () => ({ stat: mocks.stat }) }));
vi.mock("@/lib/ssh/client", () => ({ listRemoteDirectory: mocks.ssh }));
vi.mock("@/lib/auth/team-scope", () => ({ teamWhere: () => ({ teamId: "team-a" }) }));
import { restoreFileEntry } from "../service-entries";
const session: Parameters<typeof restoreFileEntry>[1] = { userId: "viewer", roles: ["operator"], currentTeamId: "team-a" };
const row = { id: "deleted-file", isDeleted: true, entryType: "FILE", relativePath: "docs/report.txt",
  storageNode: { id: "webdav", driver: "WEBDAV", basePath: "", teamId: "team-a", webdavConfigEncrypted: "encrypted" } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.findFirst.mockImplementation(async ({ where }) => where.id ? row : null);
  mocks.stat.mockResolvedValue({ isDirectory: false });
});
describe("WebDAV recycle-bin restore", () => {
  it("refuses to restore a file separately while its parent remains in the bin", async () => {
    mocks.findFirst.mockImplementation(async ({ where }) => where.id ? row : { id: "recycled-parent" });
    await expect(restoreFileEntry({ fileEntryId: row.id }, session)).rejects.toMatchObject({ status: 409 });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("checks the backing object with the WebDAV adapter before restoring", async () => {
    await restoreFileEntry({ fileEntryId: row.id }, session);
    expect(mocks.stat).toHaveBeenCalledWith("docs/report.txt", true);
    expect(mocks.ssh).not.toHaveBeenCalled();
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: row.id, storageNode: { teamId: "team-a" } } }));
    expect(mocks.update).toHaveBeenCalledWith({ where: expect.objectContaining({ id: row.id, isDeleted: true, storageNode: { teamId: "team-a" } }), data: { isDeleted: false, deleteBatchId: null, deletedAgentRoot: null } });
  });
  it.each([null, { isDirectory: true }])("rejects a missing or mismatched backing file (%s)", async (entry) => {
    mocks.stat.mockResolvedValue(entry);
    await expect(restoreFileEntry({ fileEntryId: row.id }, session)).rejects.toThrow();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("does not expose upstream credentials in connection failures", async () => {
    mocks.stat.mockRejectedValue(new Error("https://user:secret@example.com"));
    await expect(restoreFileEntry({ fileEntryId: row.id }, session)).rejects.not.toThrow(/secret/);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects an inaccessible row before contacting WebDAV", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(restoreFileEntry({ fileEntryId: row.id }, session)).rejects.toThrow();
    expect(mocks.stat).not.toHaveBeenCalled();
  });
});

it("checks each recycled child before reviving the directory batch", async () => {
  mocks.findFirst.mockResolvedValue({ ...row, entryType: "DIRECTORY", relativePath: "docs", deleteBatchId: "batch" });
  mocks.findMany.mockResolvedValue([{ ...row, id: "child" }]);
  mocks.stat.mockResolvedValueOnce({ isDirectory: true }).mockResolvedValueOnce(null);
  await expect(restoreFileEntry({ fileEntryId: row.id }, session)).rejects.toThrow();
  expect(mocks.stat.mock.calls).toEqual([["docs", true], ["docs/report.txt", true]]);
  expect(mocks.transaction).not.toHaveBeenCalled();
});

it("requires the recycled Agent root and the saved object version", async () => {
  const root = "v2:" + "a".repeat(64);
  const agentRow = { ...row, deletedAgentRoot: root, storageVersion: "version-before-delete", storageNode: {
    ...row.storageNode, driver: "AGENT", agentFileShare: { rootIdentity: "v2:other" },
  } };
  mocks.findFirst.mockResolvedValue(agentRow);
  await expect(restoreFileEntry({ fileEntryId: row.id }, session)).rejects.toMatchObject({ status: 409 });
  expect(mocks.agent).not.toHaveBeenCalled();
  mocks.findFirst.mockResolvedValue({ ...agentRow, storageNode: { ...agentRow.storageNode, agentFileShare: { rootIdentity: root } } });
  mocks.agent.mockResolvedValue({ entry: { name: "report.txt", isDirectory: false, etag: "other-version", size: 5, lastModifiedMs: 10 } });
  await expect(restoreFileEntry({ fileEntryId: row.id }, session)).rejects.toMatchObject({ status: 409 });
  expect(mocks.update).not.toHaveBeenCalled();
});
