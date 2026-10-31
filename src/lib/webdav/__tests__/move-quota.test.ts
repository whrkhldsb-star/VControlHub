/** @vitest-environment node */
import { expect, it, vi } from "vitest";

/**
 * WebDAV verb handlers. The behaviours pinned here are the ones a client cannot
 * see going wrong until it has already lost data or exceeded a limit:
 *
 *   - a directory listing that is short but returns 207 (see listDirectChildren)
 *   - COPY duplicating bytes without charging them to the destination grant,
 *     which skips BOTH maxFileBytes and quotaBytes inside assertStorageAccess
 *   - a Destination header that points at a different storage node
 */

const mocks = vi.hoisted(() => ({
  shareLink: {
    findMany: vi.fn(async (): Promise<Array<{ id: string; path: string }>> => []),
    update: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
  assertStorageAccess: vi.fn(),
  releaseStorageQuotaGuard: vi.fn(),
  storageNodeFindFirst: vi.fn(),
  fileEntryFindFirst: vi.fn(),
  fileEntryUpdate: vi.fn(),
  fileEntryUpdateMany: vi.fn(),
  fileEntryFindMany: vi.fn(async (): Promise<Array<{ id: string; relativePath: string; entryType: string }>> => []),
  fileEntryDeleteMany: vi.fn(async () => ({ count: 0 })),
  fileEntryDelete: vi.fn(async () => ({})),
  fileVersionFindMany: vi.fn(async (): Promise<Array<{ fileEntryId: string }>> => []),
  purgeFileEntryVersionDirectories: vi.fn(async () => undefined),
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  streamStorageFile: vi.fn(),
  statBackingObject: vi.fn(async (): Promise<{ size: number; lastModifiedMs: number } | null> => null),
  copyStorageFile: vi.fn(),
  writeStorageFileBuffer: vi.fn(),
  deleteStorageFileBuffer: vi.fn(),
  createFileEntry: vi.fn(),
  createManagedFolder: vi.fn(),
  deleteBackingObject: vi.fn(),
  renameBackingObject: vi.fn(),
  snapshotFileVersionBeforeOverwrite: vi.fn(),
  readRequestBodyBuffer: vi.fn(),
}));

vi.mock("@/lib/storage/file-overwrite-lock", () => ({ lockStorageFileOverwrite: async () => async () => {} }));
vi.mock("@/lib/db", () => ({
  prisma: {
    storageNode: { findFirst: mocks.storageNodeFindFirst },
    // No recycle-bin rows at the destination unless a test says otherwise.
    fileEntry: {
      findFirst: mocks.fileEntryFindFirst,
      findMany: mocks.fileEntryFindMany,
      update: mocks.fileEntryUpdate,
      deleteMany: mocks.fileEntryDeleteMany,
    },
    fileVersion: { findMany: mocks.fileVersionFindMany },
    shareLink: mocks.shareLink,
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/auth/team-scope", () => ({
  teamWhere: () => ({ teamId: "team_a" }),
  storageNodeTeamWhere: () => ({ teamId: "team_a" }),
}));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: mocks.assertStorageAccess,
  releaseStorageQuotaGuard: mocks.releaseStorageQuotaGuard,
}));
vi.mock("@/lib/storage/file-content", async () => {
  const actual = await import("@/lib/storage/file-content");
  return {
    storageFileNodeSelect: actual.storageFileNodeSelect,
    streamStorageFile: mocks.streamStorageFile,
    copyStorageFile: mocks.copyStorageFile,
    writeStorageFileBuffer: mocks.writeStorageFileBuffer,
    deleteStorageFileBuffer: mocks.deleteStorageFileBuffer,
  };
});
vi.mock("@/lib/storage/fs-backend", () => ({
  createManagedFolder: mocks.createManagedFolder,
  deleteBackingObject: mocks.deleteBackingObject,
  renameBackingObject: mocks.renameBackingObject,
  statBackingObject: mocks.statBackingObject,
}));
vi.mock("@/lib/storage/service-entries", () => ({ createFileEntry: mocks.createFileEntry }));
vi.mock("@/lib/storage/file-versions", () => ({
  snapshotFileVersionBeforeOverwrite: mocks.snapshotFileVersionBeforeOverwrite,
  purgeFileEntryVersionDirectories: mocks.purgeFileEntryVersionDirectories,
}));
vi.mock("@/lib/http/request-body", async () => {
  const actual = await import("@/lib/http/request-body");
  return {
    readRequestBodyBuffer: mocks.readRequestBodyBuffer,
    RequestBodyTooLargeError: actual.RequestBodyTooLargeError,
  };
});
vi.mock("@/lib/i18n/service-translations", () => ({ t: (key: string) => key }));
vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { handleWebDavMove } = await import("../handler");

const SESSION = { userId: "u1", username: "alice", roles: ["operator"], currentTeamId: "team_a" };

function context(relativePath: string) {
  return {
    session: SESSION as never,
    storageNodeId: "n1",
    relativePath,
    requestUrl: new URL(`https://hub.example/api/webdav/n1/${relativePath}`),
    rangeHeader: null,
  };
}

/** The transaction client the handlers see. */
function txClient() {
  return {
    fileEntry: {
      update: mocks.fileEntryUpdate,
      updateMany: mocks.fileEntryUpdateMany,
      deleteMany: mocks.fileEntryDeleteMany,
      delete: mocks.fileEntryDelete,
    },
    shareLink: mocks.shareLink,
    $executeRaw: mocks.executeRaw,
  };
}

function accessCalls() {
  return mocks.assertStorageAccess.mock.calls.map(
    (call) => call[0] as { relativePath: string; operation: string; writeBytes?: number },
  );
}


it("passes moved capacity to the target grant and releases the quota guard", async () => {
  mocks.assertStorageAccess.mockResolvedValue({ allowed: true });
  mocks.storageNodeFindFirst.mockResolvedValue({ id: "n1", name: "docs", driver: "LOCAL", basePath: "/unused-audit" });
  mocks.fileEntryFindFirst.mockResolvedValueOnce({ id: "file1", relativePath: "unlimited/big.bin", name: "big.bin", entryType: "FILE", size: BigInt(1000) }).mockResolvedValueOnce(null);
  mocks.transaction.mockImplementation(async (f) => f(txClient()));
  const response = await handleWebDavMove(context("unlimited/big.bin"), new Request("https://hub.example/api/webdav/n1/unlimited/big.bin", { method: "POST", headers: { destination: "/api/webdav/n1/limited/big.bin" } }));
  expect(response.status).toBe(201);
  expect(accessCalls()).toContainEqual(expect.objectContaining({ relativePath: "limited/big.bin", writeBytes: BigInt(1000), largestFileBytes: BigInt(1000), movedFrom: "unlimited/big.bin" }));
  expect(mocks.releaseStorageQuotaGuard).toHaveBeenCalled();
});
