import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

const {
  requireApiSessionMock,
  sessionHasPermissionMock,
  lockedRowsMock,
  imageFindManyMock,
  imageDeleteManyMock,
  imageUpdateManyMock,
  imageUpdateMock,
  unlinkMock,
  nodeFindFirstMock,
  lockStorageFileOverwriteMock,
  transactionMock,
  mediaDeleteManyMock,
  fileEntryDeleteManyMock,
  deleteBackingObjectMock, renameBackingObjectMock,
} = vi.hoisted(() => ({
  lockedRowsMock: vi.fn(),
  nodeFindFirstMock: vi.fn(),
  lockStorageFileOverwriteMock: vi.fn(async () => async () => {}),
  transactionMock: vi.fn(function<T>(this: unknown, callback: (tx: unknown) => T) { return callback(this); }),
  mediaDeleteManyMock: vi.fn(),
  fileEntryDeleteManyMock: vi.fn().mockResolvedValue({ count: 1 }),
  deleteBackingObjectMock: vi.fn(),
  renameBackingObjectMock: vi.fn(async (_input: { oldRelativePath: string }) => {}),
  requireApiSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  imageFindManyMock: vi.fn(),
  imageDeleteManyMock: vi.fn(),
  imageUpdateManyMock: vi.fn(),
  imageUpdateMock: vi.fn(),
  unlinkMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: requireApiSessionMock,

  isSessionPayload: (value: unknown) => Boolean(value),
}));
vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: sessionHasPermissionMock,
}));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: vi.fn() }));
vi.mock("@/lib/storage/file-overwrite-lock", () => ({ lockStorageFileOverwrite: lockStorageFileOverwriteMock }));
vi.mock("@/lib/storage/access-control", () => ({ assertStorageAccess: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock("@/lib/storage/file-content", () => ({ storageFileNodeSelect: { id: true, driver: true, basePath: true }, streamStorageFile: async () => ({ size: 3, stream: Readable.from(["img"]), close: () => {} }) }));
vi.mock("@/lib/storage/fs-backend", () => ({
  deleteBackingObject: deleteBackingObjectMock, renameBackingObject: renameBackingObjectMock, moveBackingObject: vi.fn(),
  statBackingObject: async ({ relativePath }: { relativePath: string }) =>
    renameBackingObjectMock.mock.calls.some(([move]) => move.oldRelativePath === relativePath) ? null : { size: 3, isDirectory: false },
}));
vi.mock("node:fs/promises", () => ({
  default: { mkdir: vi.fn(), writeFile: vi.fn(), unlink: unlinkMock },
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  unlink: unlinkMock,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    imageUpload: {
      findMany: imageFindManyMock,
      deleteMany: imageDeleteManyMock,
      updateMany: imageUpdateManyMock,
      update: imageUpdateMock,
    },
    storageNode: { findFirst: nodeFindFirstMock },
    mediaItem: { deleteMany: mediaDeleteManyMock },
    fileEntry: { findFirst: vi.fn().mockResolvedValue({ id: "uploaded" }), deleteMany: fileEntryDeleteManyMock },
    $queryRaw: (sql: TemplateStringsArray) => sql.join("").includes("FROM image_uploads") ? lockedRowsMock() : [{ id: "team_1" }],
    $transaction: transactionMock,
  },
}));
vi.mock("@/lib/image-bed/constants", () => ({
  UPLOAD_DIR: "/tmp/vcontrolhub-image-batch-test",
}));
vi.mock("@/lib/http/rate-limit-presets", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/http/rate-limit-presets")
  >("@/lib/http/rate-limit-presets");
  return {
    ...actual,
    withRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  };
});

import { POST } from "../route";

const imageGeneration = { sizeBytes: 3, checksum: createHash("sha256").update("img").digest("hex"), createdAt: new Date(12345) };
const ownerSession = { userId: "u_1", username: "alice", currentTeamId: "team_1" };
const managerSession = {
  userId: "u_manager",
  username: "manager",
  currentTeamId: "team_1",
};
const activeCustomers = { teamId: "team_1", team: { deletedAt: null } };
const viewerSession = { userId: "u_viewer", username: "viewer" };

function givenImages(rows: Array<{ id: string; storageKey: string; storageNodeId?: string | null; relativePath?: string | null }>) {
  const images = rows.map(row => ({ ...row, teamId: "team_1" }));
  lockedRowsMock.mockResolvedValueOnce(images);
  imageFindManyMock.mockResolvedValueOnce(images);
}

async function postBatch(body: unknown) {
  return POST(
    new Request("https://example.com/api/images/batch", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

describe("/api/images/batch", () => {
  it("keeps regular users scoped to their own images for non-destructive batch updates", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(ownerSession);
    sessionHasPermissionMock.mockImplementation(
      (_session: unknown, permission: string) => permission === "image:write",
    );
    imageUpdateManyMock.mockResolvedValueOnce({ count: 1 });

    const response = await postBatch({
      action: "moveAlbum",
      ids: ["img_1", "img_2"],
      album: "personal",
    });

    expect(response.status).toBe(200);
    expect(imageUpdateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["img_1", "img_2"] }, userId: "u_1", ...activeCustomers },
      data: { album: "personal" },
    });
  });

  it("does not let user:read viewers batch-delete other users' images", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(viewerSession);
    sessionHasPermissionMock.mockImplementation(
      (_session, permission) => permission === "user:read",
    );

    const response = await postBatch({ action: "delete", ids: ["img_2"] });

    // image:write is required by withApiRoute; pure viewers never reach delete logic.
    expect(response.status).toBe(403);
    expect(imageFindManyMock).not.toHaveBeenCalled();
    expect(imageDeleteManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: "Insufficient permissions",
    });
  });

  it("allows image owners to batch-delete their own images without media:manage", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(ownerSession);
    sessionHasPermissionMock.mockImplementation(
      (_session: unknown, permission: string) => permission === "image:write",
    );
    givenImages([
      {
        id: "img_1",
        storageKey: "albums/mine.png",
        storageNodeId: null,
        relativePath: null,
      },
    ]);
    imageDeleteManyMock.mockResolvedValueOnce({ count: 1 });
    unlinkMock.mockResolvedValue(undefined);

    const response = await postBatch({
      action: "delete",
      ids: ["img_1", "img_other"],
    });

    expect(response.status).toBe(200);
    expect(imageFindManyMock).toHaveBeenCalledWith({
      where: { AND: [{ id: { in: ["img_1", "img_other"] }, userId: "u_1", ...activeCustomers }, { id: { in: ["img_1"] } }] },
      select: {
        id: true,
        storageKey: true,
        teamId: true,
        checksum: true,
        sizeBytes: true,
        createdAt: true,
        storageNodeId: true,
        relativePath: true,
      },
      take: 100,
    });
    expect(imageDeleteManyMock).toHaveBeenCalledWith({
      where: {
        AND: [
          { id: { in: ["img_1", "img_other"] }, userId: "u_1", ...activeCustomers },
          { id: { in: ["img_1"] } },
        ],
      },
    });
    await expect(response.json()).resolves.toEqual({
      deleted: 1,
      filesDeleted: 1,
      failedFileIds: [],
    });
  });

  it("allows media managers to batch-delete selected images across owners", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(managerSession);
    sessionHasPermissionMock.mockImplementation(
      (_session, permission) =>
        permission === "image:write" ||
        permission === "media:manage" ||
        permission === "team:manage",
    );
    givenImages([
      { id: "img_2", storageKey: "albums/remote.png" },
    ]);
    imageDeleteManyMock.mockResolvedValueOnce({ count: 1 });
    unlinkMock.mockResolvedValue(undefined);

    const response = await postBatch({ action: "delete", ids: ["img_2"] });

    expect(response.status).toBe(200);
    expect(imageFindManyMock).toHaveBeenCalledWith({
      where: { AND: [{ id: { in: ["img_2"] }, ...activeCustomers }, { id: { in: ["img_2"] } }] },
      select: {
        id: true,
        storageKey: true,
        teamId: true,
        checksum: true,
        sizeBytes: true,
        createdAt: true,
        storageNodeId: true,
        relativePath: true,
      },
      take: 100,
    });
    expect(imageDeleteManyMock).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            id: { in: ["img_2"] },
            ...activeCustomers,
          },
          { id: { in: ["img_2"] } },
        ],
      },
    });
    expect(unlinkMock).toHaveBeenCalledWith(
      path.join("/tmp/vcontrolhub-image-batch-test/albums", "remote.png"),
    );
    expect(unlinkMock).toHaveBeenCalledWith(
      path.join("/tmp/vcontrolhub-image-batch-test/albums", "remote_thumb.webp"),
    );
    await expect(response.json()).resolves.toEqual({
      deleted: 1,
      filesDeleted: 1,
      failedFileIds: [],
    });
  });

  it("removes the storage copy an upload wrote, as deleting one image does, and leaves a file published from storage", async () => {
    // Deleting one image took its storage copy along; the same images deleted as a selection left a
    // "<uuid>.png" behind in the folder, in the file index and in the media library.
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(managerSession);
    sessionHasPermissionMock.mockImplementation((_session, permission) => permission === "image:write" || permission === "media:manage");
    givenImages([
      { ...imageGeneration, id: "uploaded", storageKey: "1111.png", storageNodeId: "node_1", relativePath: "photos/1111.png" },
      { id: "published", storageKey: "2222.png", storageNodeId: "node_1", relativePath: "photos/holiday.png" },
      { id: "elsewhere", storageKey: "3333.png", storageNodeId: "node_other_team", relativePath: "x/3333.png" },
      { id: "plain", storageKey: "4444.png", storageNodeId: null, relativePath: null },
    ]);
    imageDeleteManyMock.mockResolvedValueOnce({ count: 4 });
    unlinkMock.mockResolvedValue(undefined);
    const node = { id: "node_1", teamId: "team_1", driver: "LOCAL", basePath: "/srv/files" };
    nodeFindFirstMock.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "node_1" ? node : null));

    const response = await postBatch({ action: "delete", ids: ["uploaded", "published", "elsewhere", "plain"] });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: 4, filesDeleted: 4, failedFileIds: [] });
    // Only nodes the caller's team can reach are looked at, and locks are acquired in canonical order before reading StorageNode.
    expect(lockStorageFileOverwriteMock.mock.calls).toEqual([
      ["node_1", "photos/1111.png"],
      ["node_other_team", "x/3333.png"],
    ]);
    expect(lockStorageFileOverwriteMock.mock.invocationCallOrder[0]).toBeLessThan(nodeFindFirstMock.mock.invocationCallOrder[0]!);
    expect(nodeFindFirstMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "node_1", teamId: "team_1" } }));
    expect(nodeFindFirstMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "node_other_team", teamId: "team_1" } }));
    expect(deleteBackingObjectMock).toHaveBeenCalledTimes(1);
    expect(deleteBackingObjectMock).toHaveBeenCalledWith({ storageNode: node, relativePath: expect.stringMatching(/^photos\/\.vch-backup-/), isDirectory: false, tolerateMissing: true });
    expect(fileEntryDeleteManyMock).toHaveBeenCalledWith({ where: expect.objectContaining({ storageNodeId: "node_1", relativePath: "photos/1111.png", id: "uploaded", isDeleted: false, updatedAt: imageGeneration.createdAt }) });
    expect(mediaDeleteManyMock).toHaveBeenCalledWith({ where: { storageNodeId: "node_1", relativePath: "photos/1111.png", fileEntryId: "uploaded" } });
  });

  it("says so when a storage copy could not be removed", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(managerSession);
    sessionHasPermissionMock.mockImplementation((_session, permission) => permission === "image:write" || permission === "media:manage");
    givenImages([{ ...imageGeneration, id: "uploaded", storageKey: "1111.png", storageNodeId: "node_1", relativePath: "photos/1111.png" }]);
    imageDeleteManyMock.mockResolvedValueOnce({ count: 1 });
    unlinkMock.mockResolvedValue(undefined);
    nodeFindFirstMock.mockResolvedValueOnce({ id: "node_1", teamId: "team_1", driver: "SFTP", basePath: "/srv/files" });
    deleteBackingObjectMock.mockRejectedValueOnce(new Error("connection refused"));

    const response = await postBatch({ action: "delete", ids: ["uploaded"] });

    // The image is deleted; what is left is a file to clean up.
    expect(response.status).toBe(207);
    await expect(response.json()).resolves.toEqual({ deleted: 1, filesDeleted: 1, failedFileIds: [], linkedCleanupFailures: ["uploaded"], cleanupPending: true });
  });

  it("returns 207 and keeps DB deletion committed when image files fail to unlink after commit", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(managerSession);
    sessionHasPermissionMock.mockImplementation(
      (_session, permission) =>
        permission === "image:write" || permission === "media:manage",
    );
    givenImages([
      { id: "img_2", storageKey: "albums/remote.png" },
    ]);
    imageDeleteManyMock.mockResolvedValueOnce({ count: 1 });
    unlinkMock.mockRejectedValue(
      Object.assign(new Error("EACCES"), { code: "EACCES" }),
    );

    const response = await postBatch({ action: "delete", ids: ["img_2"] });

    expect(response.status).toBe(207);
    expect(imageDeleteManyMock).toHaveBeenCalledTimes(1);
    expect(imageDeleteManyMock.mock.invocationCallOrder[0]).toBeLessThan(unlinkMock.mock.invocationCallOrder[0]!);
    await expect(response.json()).resolves.toEqual({
      deleted: 1,
      filesDeleted: 0,
      failedFileIds: ["img_2"],
      success: false,
      partial: true,
      cleanupPending: true,
    });
  });

  it("does not unlink local or linked storage files when the DB transaction fails", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(managerSession);
    sessionHasPermissionMock.mockImplementation(
      (_session, permission) =>
        permission === "image:write" || permission === "media:manage",
    );
    transactionMock.mockRejectedValueOnce(new Error("tx failed"));

    const response = await postBatch({ action: "delete", ids: ["img_2"] });

    expect(response.status).toBe(500);
    expect(unlinkMock).not.toHaveBeenCalled();
    expect(lockStorageFileOverwriteMock).not.toHaveBeenCalled();
    expect(deleteBackingObjectMock).not.toHaveBeenCalled();
  });
});
