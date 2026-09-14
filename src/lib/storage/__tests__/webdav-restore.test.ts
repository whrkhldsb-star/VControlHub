import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), update: vi.fn(), stat: vi.fn(), ssh: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { fileEntry: { findFirst: mocks.findFirst, update: mocks.update } }, isUniqueViolation: () => false }));
vi.mock("@/lib/storage/webdav-client", () => ({ createWebDavClient: () => ({ stat: mocks.stat }) }));
vi.mock("@/lib/ssh/client", () => ({ listRemoteDirectory: mocks.ssh }));
vi.mock("@/lib/auth/team-scope", () => ({ teamWhere: () => ({ teamId: "team-a" }) }));
import { restoreFileEntry } from "../service-entries";
const session: Parameters<typeof restoreFileEntry>[1] = { userId: "viewer", roles: ["operator"], currentTeamId: "team-a" };
const row = { id: "deleted-file", isDeleted: true, entryType: "FILE", relativePath: "docs/report.txt",
  storageNode: { id: "webdav", driver: "WEBDAV", basePath: "", teamId: "team-a", webdavConfigEncrypted: "encrypted" } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.findFirst.mockResolvedValue(row);
  mocks.stat.mockResolvedValue({ isDirectory: false });
});
describe("WebDAV recycle-bin restore", () => {
  it("checks the backing object with the WebDAV adapter before restoring", async () => {
    await restoreFileEntry({ fileEntryId: row.id }, session);
    expect(mocks.stat).toHaveBeenCalledWith("docs/report.txt");
    expect(mocks.ssh).not.toHaveBeenCalled();
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: row.id, storageNode: { teamId: "team-a" } } }));
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: row.id, storageNode: { teamId: "team-a" } }, data: { isDeleted: false, deleteBatchId: null } });
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
