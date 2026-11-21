import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

/** Matches the mocked UPLOAD_DIR below; resolved natively per platform. */
const uploadDir = (...segments: string[]) =>
  path.join("/tmp/vcontrolhub-image-delete-test", ...segments);
const imageGeneration = { sizeBytes: 3, checksum: createHash("sha256").update("img").digest("hex"), createdAt: new Date(12345) };

const {
  requireApiSessionMock,
  sessionHasPermissionMock,
  imageFindUniqueMock,
  imageDeleteMock,
  storageFindManyMock,
  mediaDeleteManyMock,
  fileDeleteManyMock,
  transactionMock,
  unlinkMock,
} = vi.hoisted(() => ({
  requireApiSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  imageFindUniqueMock: vi.fn(),
  imageDeleteMock: vi.fn(),
  storageFindManyMock: vi.fn(),
  mediaDeleteManyMock: vi.fn(),
  fileDeleteManyMock: vi.fn().mockResolvedValue({ count: 1 }),
  transactionMock: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    fileEntry: { deleteMany: fileDeleteManyMock },
    mediaItem: { deleteMany: mediaDeleteManyMock },
  })),
  unlinkMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: requireApiSessionMock,

  isSessionPayload: (value: unknown) => Boolean(value),
}));
vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: sessionHasPermissionMock,
}));
vi.mock("@/lib/auth/team-scope", () => ({
  isGlobalTeamManager: () => false,
  seesAllCustomers: () => false,
  teamWhere: () => ({ teamId: "team_1" }),
}));
const { accessMock, lockMock, readEntryMock, streamMock } = vi.hoisted(() => ({
  accessMock: vi.fn().mockResolvedValue({ allowed: true }),
  lockMock: vi.fn(async () => async () => {}),
  readEntryMock: vi.fn().mockResolvedValue({ id: "img_1" }),
  streamMock: vi.fn(async () => ({ size: 3, stream: Readable.from([Buffer.from("img")]), close: () => {} })),
}));
vi.mock("@/lib/storage/access-control", () => ({ assertStorageAccess: accessMock }));
vi.mock("@/lib/storage/file-overwrite-lock", () => ({ lockStorageFileOverwrite: lockMock }));
vi.mock("@/lib/storage/file-content", () => ({ storageFileNodeSelect: { id: true }, streamStorageFile: streamMock }));
vi.mock("node:fs/promises", () => ({ default: { unlink: unlinkMock }, unlink: unlinkMock }));
vi.mock("@/lib/db", () => ({
  prisma: {
    imageUpload: {
      findUnique: imageFindUniqueMock,
      delete: imageDeleteMock,
    },
    storageNode: {
      findMany: storageFindManyMock,
    },
    mediaItem: { deleteMany: mediaDeleteManyMock },
    fileEntry: { findFirst: readEntryMock, deleteMany: fileDeleteManyMock },
    $transaction: transactionMock,
  },
}));
const { deleteBackingObjectMock, renameBackingObjectMock, moveBackingObjectMock, statBackingObjectMock } = vi.hoisted(() => {
  const renameBackingObjectMock = vi.fn(async (_input: { oldRelativePath: string; newRelativePath: string }) => {});
  const statBackingObjectMock = vi.fn(async ({ relativePath }: { relativePath: string }): Promise<{ size: number; isDirectory: boolean } | null> =>
    renameBackingObjectMock.mock.calls.some(([move]) => move.oldRelativePath === relativePath) ? null : { size: 3, isDirectory: false });
  return {
    renameBackingObjectMock, statBackingObjectMock,
    deleteBackingObjectMock: vi.fn(async (_input: { relativePath: string }) => {}),
    moveBackingObjectMock: vi.fn(async (_input: { oldRelativePath: string; newRelativePath: string }) => {}),
  };
});
vi.mock("@/lib/storage/fs-backend", () => ({
  deleteBackingObject: deleteBackingObjectMock, statBackingObject: statBackingObjectMock,
  renameBackingObject: renameBackingObjectMock, moveBackingObject: moveBackingObjectMock,
}));
vi.mock("@/lib/image-bed/constants", () => ({
  UPLOAD_DIR: "/tmp/vcontrolhub-image-delete-test",
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

import { DELETE } from "../route";

const session = {
  userId: "u_1",
  username: "alice",
  roles: ["operator"] as string[],
  currentTeamId: "team_1" as string | null,
  mustChangePassword: false,
};

describe("/api/images/[id]", () => {
  it("refuses deletion by the original uploader after transfer to another customer", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce({ ...session, currentTeamId: "team_2" });
    sessionHasPermissionMock.mockImplementation((_s: unknown, permission: string) => permission === "image:write");
    imageFindUniqueMock.mockResolvedValueOnce({ id: "img_1", userId: session.userId, teamId: "team_1", storageKey: "img.png", storageNodeId: null, relativePath: null });
    const result = await DELETE(new Request("http://local/api/images/img_1", { method: "DELETE" }), { params: Promise.resolve({ id: "img_1" }) });
    expect(result.status).toBe(403);
    expect(imageDeleteMock).not.toHaveBeenCalled();
    expect(unlinkMock).not.toHaveBeenCalled();
  });
  it("revokes the image record before removing backing files", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation(
      (_session: unknown, permission: string) => permission === "image:write",
    );
    imageFindUniqueMock.mockResolvedValueOnce({
      id: "img_1",
      userId: "u_1",
      teamId: "team_1",
      storageKey: "img.png",
      storageNodeId: null,
      relativePath: null,
    });
    unlinkMock.mockResolvedValue(undefined);
    imageDeleteMock.mockResolvedValueOnce({ id: "img_1" });

    const response = await DELETE(
      new Request("https://example.com/api/images/img_1", { method: "DELETE" }),
      {
        params: Promise.resolve({ id: "img_1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(requireApiSessionMock).toHaveBeenCalled();
    expect(unlinkMock).toHaveBeenCalledWith(
      uploadDir("img.png"),
    );
    expect(imageDeleteMock).toHaveBeenCalledWith({ where: { id: "img_1" } });
    expect(imageDeleteMock.mock.invocationCallOrder[0]).toBeLessThan(
      unlinkMock.mock.invocationCallOrder[0]!,
    );
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });

  it("keeps access revoked and reports pending cleanup when image files cannot be removed", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation(
      (_session: unknown, permission: string) => permission === "image:write",
    );
    imageFindUniqueMock.mockResolvedValueOnce({
      id: "img_1",
      userId: "u_1",
      teamId: "team_1",
      storageKey: "img.png",
      storageNodeId: null,
      relativePath: null,
    });
    unlinkMock.mockRejectedValueOnce(
      Object.assign(new Error("EACCES"), { code: "EACCES" }),
    );
    imageDeleteMock.mockResolvedValueOnce({ id: "img_1" });

    const response = await DELETE(
      new Request("https://example.com/api/images/img_1", { method: "DELETE" }),
      {
        params: Promise.resolve({ id: "img_1" }),
      },
    );

    expect(response.status).toBe(207);
    expect(imageDeleteMock).toHaveBeenCalledWith({ where: { id: "img_1" } });
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      deleted: true,
      cleanupPending: true,
      cleanupFailures: ["imageBed"],
    });
  });

  it("deletes linked LOCAL storage copies after revoking the image record", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation(
      (_session: unknown, permission: string) => permission === "image:write",
    );
    imageFindUniqueMock.mockResolvedValueOnce({
      id: "img_1",
      userId: "u_1",
      teamId: "team_1",
      storageKey: "img.png",
      storageNodeId: "node_1",
      relativePath: "album/img.png",
      ...imageGeneration,
    });
    storageFindManyMock.mockResolvedValueOnce([{
      id: "node_1",
      driver: "LOCAL",
      basePath: "/srv/images",
    }]);
    unlinkMock.mockResolvedValue(undefined);
    imageDeleteMock.mockResolvedValueOnce({ id: "img_1" });

    const response = await DELETE(
      new Request("https://example.com/api/images/img_1", { method: "DELETE" }),
      {
        params: Promise.resolve({ id: "img_1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(unlinkMock).toHaveBeenCalledWith(
      uploadDir("img.png"),
    );
    expect(deleteBackingObjectMock).toHaveBeenCalledWith(expect.objectContaining({ relativePath: expect.stringMatching(/^album\/\.vch-backup-/), isDirectory: false }));
    expect(fileDeleteManyMock).toHaveBeenCalledWith({ where: {
      id: "img_1", storageNodeId: "node_1", relativePath: "album/img.png", updatedAt: imageGeneration.createdAt,
      entryType: "FILE", isDeleted: false, size: BigInt(3), checksumSha256: imageGeneration.checksum,
    } });
    expect(mediaDeleteManyMock).toHaveBeenCalledWith({ where: { storageNodeId: "node_1", relativePath: "album/img.png", fileEntryId: "img_1" } });
    expect(imageDeleteMock.mock.invocationCallOrder[0]).toBeLessThan(deleteBackingObjectMock.mock.invocationCallOrder[0]!);
    expect(lockMock.mock.invocationCallOrder[0]).toBeLessThan(accessMock.mock.invocationCallOrder[0]!);
    expect(accessMock).toHaveBeenCalledWith(expect.objectContaining({ operation: "delete", relativePath: "album/img.png" }));
  });

  it("deletes the copy an upload wrote to an SFTP folder", async () => {
    // Only LOCAL copies were removed: the SFTP one stayed on the server and
    // the next sync put it back into the file index.
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation((_session: unknown, permission: string) => permission === "image:write");
    imageFindUniqueMock.mockResolvedValueOnce({ id: "img_s", userId: "u_1", teamId: "team_1", storageKey: "img.png", storageNodeId: "node_s", relativePath: "album/img.png", ...imageGeneration });
    const node = { id: "node_s", driver: "SFTP", basePath: "/data" };
    storageFindManyMock.mockResolvedValueOnce([node]);
    unlinkMock.mockResolvedValue(undefined);
    imageDeleteMock.mockResolvedValueOnce({ id: "img_s" });

    const response = await DELETE(new Request("https://example.com/api/images/img_s", { method: "DELETE" }), { params: Promise.resolve({ id: "img_s" }) });

    expect(response.status).toBe(200);
    expect(deleteBackingObjectMock).toHaveBeenCalledWith({ storageNode: node, relativePath: expect.stringMatching(/^album\/\.vch-backup-/), isDirectory: false, tolerateMissing: true });
    expect(fileDeleteManyMock).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "img_s", storageNodeId: "node_s", relativePath: "album/img.png" }) });
  });

  it("leaves the user's own source file alone for an image published from storage", async () => {
    // The record points at the source file (another name than the image's
    // storage key): treating it as a legacy directory failed every delete
    // with ENOTDIR and reported a cleanup that was never owed.
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation((_session: unknown, permission: string) => permission === "image:write");
    imageFindUniqueMock.mockResolvedValueOnce({
      id: "img_1",
      userId: "u_1",
      teamId: "team_1",
      storageKey: "2f1c0b7e-uuid.png",
      storageNodeId: "node_1",
      relativePath: "source/photo.png",
    });
    unlinkMock.mockResolvedValue(undefined);
    imageDeleteMock.mockResolvedValueOnce({ id: "img_1" });

    const response = await DELETE(new Request("https://example.com/api/images/img_1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "img_1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(unlinkMock).not.toHaveBeenCalledWith(expect.stringContaining(path.join("source", "photo.png")));
  });

  it("keeps access revoked when a linked LOCAL storage copy cannot be removed", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation(
      (_session: unknown, permission: string) => permission === "image:write",
    );
    imageFindUniqueMock.mockResolvedValueOnce({
      id: "img_1",
      userId: "u_1",
      teamId: "team_1",
      storageKey: "img.png",
      storageNodeId: "node_1",
      relativePath: "album/img.png",
      ...imageGeneration,
    });
    storageFindManyMock.mockResolvedValueOnce([{ id: "node_1", driver: "LOCAL", basePath: "/srv/images" }]);
    deleteBackingObjectMock.mockRejectedValueOnce(new Error("permission denied"));
    imageDeleteMock.mockResolvedValueOnce({ id: "img_1" });

    const response = await DELETE(
      new Request("https://example.com/api/images/img_1", { method: "DELETE" }),
      {
        params: Promise.resolve({ id: "img_1" }),
      },
    );

    expect(response.status).toBe(207);
    expect(imageDeleteMock).toHaveBeenCalledWith({ where: { id: "img_1" } });
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      deleted: true,
      cleanupPending: true,
      cleanupFailures: ["linkedStorage"],
    });
  });

  it.each(["replacement row", "same-size external replacement", "delete grant revoked", "changed during index deletion"])(
    "detaches the image and preserves stored bytes for %s", async reason => {
      vi.clearAllMocks();
      requireApiSessionMock.mockResolvedValueOnce(session);
      sessionHasPermissionMock.mockImplementation((_s, permission) => permission === "image:write");
      imageFindUniqueMock.mockResolvedValueOnce({ ...imageGeneration, id: "img_1", userId: session.userId, teamId: "team_1", storageKey: "img.png", storageNodeId: "node_1", relativePath: "album/img.png" });
      storageFindManyMock.mockResolvedValueOnce([{ id: "node_1", driver: "LOCAL", basePath: "/srv/images" }]);
      if (reason === "replacement row") readEntryMock.mockResolvedValueOnce(null);
      if (reason === "delete grant revoked") accessMock.mockResolvedValueOnce({ allowed: false });
      if (reason === "same-size external replacement") streamMock.mockResolvedValueOnce({ size: 3, stream: Readable.from(["new"]), close: () => {} });
      if (reason === "changed during index deletion") fileDeleteManyMock.mockResolvedValueOnce({ count: 0 });
      const response = await DELETE(new Request("https://example.com/api/images/img_1", { method: "DELETE" }), { params: Promise.resolve({ id: "img_1" }) });
      expect(response.status).toBe(200);
      expect(imageDeleteMock).toHaveBeenCalled();
      expect(mediaDeleteManyMock).not.toHaveBeenCalled();
      expect(deleteBackingObjectMock).not.toHaveBeenCalled();
    },
  );

  it.each(["before index cleanup", "after index claim"])("preserves a new file at the public path %s", async timing => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation((_s, permission) => permission === "image:write");
    const publicPath = "album/img.png";
    const files = new Map([[publicPath, "img"]]);
    const node = { id: "node_1", driver: "LOCAL", basePath: "/srv/images" };
    imageFindUniqueMock.mockResolvedValueOnce({ ...imageGeneration, id: "img_1", userId: session.userId, teamId: "team_1", storageKey: "img.png", storageNodeId: node.id, relativePath: publicPath });
    storageFindManyMock.mockResolvedValueOnce([node]);
    renameBackingObjectMock.mockImplementationOnce(async ({ oldRelativePath, newRelativePath }) => {
      files.set(newRelativePath, files.get(oldRelativePath)!);
      files.delete(oldRelativePath);
      if (timing === "before index cleanup") files.set(publicPath, "new");
    });
    statBackingObjectMock.mockResolvedValueOnce({ size: 3, isDirectory: false })
      .mockResolvedValueOnce({ size: 3, isDirectory: false })
      .mockImplementationOnce(async ({ relativePath }) => files.has(relativePath) ? { size: 3, isDirectory: false } : null);
    if (timing === "after index claim") {
      fileDeleteManyMock.mockImplementationOnce(async () => {
        files.set(publicPath, "new");
        return { count: 1 };
      });
    }
    deleteBackingObjectMock.mockImplementationOnce(async ({ relativePath }) => { files.delete(relativePath); });

    const response = await DELETE(new Request("http://local/api/images/img_1", { method: "DELETE" }), { params: Promise.resolve({ id: "img_1" }) });
    expect(response.status).toBe(200);
    const stage = renameBackingObjectMock.mock.calls[0]![0].newRelativePath;
    expect(streamMock).toHaveBeenCalledWith(node, stage);
    expect([...files]).toEqual([[publicPath, "new"]]);
    expect(fileDeleteManyMock).toHaveBeenCalledTimes(timing === "before index cleanup" ? 0 : 1);
  });

  it.each(["different bytes", "index failure"])("uses a no-replace restore for %s and preserves the staging copy on conflict", async reason => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation((_s, permission) => permission === "image:write");
    const node = { id: "node_1", driver: "SFTP", basePath: "/srv/images" };
    const publicPath = "album/img.png";
    imageFindUniqueMock.mockResolvedValueOnce({ ...imageGeneration, id: "img_1", userId: session.userId, teamId: "team_1", storageKey: "img.png", storageNodeId: node.id, relativePath: publicPath });
    storageFindManyMock.mockResolvedValueOnce([node]);
    if (reason === "different bytes") streamMock.mockResolvedValueOnce({ size: 3, stream: Readable.from(["new"]), close: () => {} });
    else fileDeleteManyMock.mockRejectedValueOnce(new Error("index failed"));
    moveBackingObjectMock.mockRejectedValueOnce(Object.assign(new Error("destination occupied"), { code: "EEXIST" }));

    const response = await DELETE(new Request("http://local/api/images/img_1", { method: "DELETE" }), { params: Promise.resolve({ id: "img_1" }) });
    expect(response.status).toBe(207);
    const stage = renameBackingObjectMock.mock.calls[0]![0].newRelativePath;
    expect(moveBackingObjectMock).toHaveBeenCalledWith({ storageNode: node, oldRelativePath: stage, newRelativePath: publicPath });
    expect(deleteBackingObjectMock).not.toHaveBeenCalled();
    expect(mediaDeleteManyMock).not.toHaveBeenCalled();
  });

  it("cleans only the exact index rows when the linked file is already absent", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation((_s, permission) => permission === "image:write");
    imageFindUniqueMock.mockResolvedValueOnce({ ...imageGeneration, id: "img_1", userId: session.userId, teamId: "team_1", storageKey: "img.png", storageNodeId: "node_1", relativePath: "album/img.png" });
    storageFindManyMock.mockResolvedValueOnce([{ id: "node_1", driver: "LOCAL", basePath: "/srv/images" }]);
    statBackingObjectMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    const response = await DELETE(new Request("http://local/api/images/img_1", { method: "DELETE" }), { params: Promise.resolve({ id: "img_1" }) });
    expect(response.status).toBe(200);
    expect(fileDeleteManyMock).toHaveBeenCalledTimes(1);
    expect(renameBackingObjectMock).not.toHaveBeenCalled();
    expect(deleteBackingObjectMock).not.toHaveBeenCalled();
  });

  it("rejects deletion by non-owner non-admin sessions", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation(
      (_session: unknown, permission: string) => permission === "image:write",
    );
    imageFindUniqueMock.mockResolvedValueOnce({
      id: "img_2",
      userId: "u_2",
      teamId: "team_1",
      storageKey: "img.png",
      storageNodeId: null,
      relativePath: null,
    });

    const response = await DELETE(
      new Request("https://example.com/api/images/img_2", { method: "DELETE" }),
      {
        params: Promise.resolve({ id: "img_2" }),
      },
    );

    expect(response.status).toBe(403);
    expect(imageDeleteMock).not.toHaveBeenCalled();
  });

  it("does not treat user:read as cross-user image delete permission", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation(
      (_session, permission) =>
        permission === "image:write" || permission === "user:read",
    );
    imageFindUniqueMock.mockResolvedValueOnce({
      id: "img_2",
      userId: "u_2",
      teamId: "team_1",
      storageKey: "nested/img.png",
      storageNodeId: null,
      relativePath: null,
    });

    const response = await DELETE(
      new Request("https://example.com/api/images/img_2", { method: "DELETE" }),
      {
        params: Promise.resolve({ id: "img_2" }),
      },
    );

    expect(response.status).toBe(403);
    expect(imageDeleteMock).not.toHaveBeenCalled();
  });

  it("allows explicit media manage permission to delete another user's image", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation(
      (_session, permission) =>
        permission === "image:write" ||
        permission === "media:manage" ||
        permission === "team:manage",
    );
    imageFindUniqueMock.mockResolvedValueOnce({
      id: "img_2",
      userId: "u_2",
      teamId: "team_1",
      storageKey: "nested/img.png",
      storageNodeId: null,
      relativePath: null,
    });
    unlinkMock.mockResolvedValue(undefined);
    imageDeleteMock.mockResolvedValueOnce({ id: "img_2" });

    const response = await DELETE(
      new Request("https://example.com/api/images/img_2", { method: "DELETE" }),
      {
        params: Promise.resolve({ id: "img_2" }),
      },
    );

    expect(response.status).toBe(200);
    expect(unlinkMock).toHaveBeenCalledWith(
      uploadDir("nested/img_thumb.webp"),
    );
    expect(imageDeleteMock).toHaveBeenCalledWith({ where: { id: "img_2" } });
  });

  it("rejects media managers deleting an image from another team", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation(
      (_session, permission) =>
        permission === "image:write" || permission === "media:manage",
    );
    imageFindUniqueMock.mockResolvedValueOnce({
      id: "img_foreign",
      userId: "u_foreign",
      teamId: "team_2",
      storageKey: "foreign.png",
      storageNodeId: null,
      relativePath: null,
    });

    const response = await DELETE(
      new Request("https://example.com/api/images/img_foreign", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "img_foreign" }) },
    );

    expect(response.status).toBe(403);
    expect(unlinkMock).not.toHaveBeenCalled();
    expect(imageDeleteMock).not.toHaveBeenCalled();
  });

  it("rejects media managers deleting a legacy unassigned image they do not own", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation(
      (_session, permission) =>
        permission === "image:write" || permission === "media:manage",
    );
    imageFindUniqueMock.mockResolvedValueOnce({
      id: "img_legacy",
      userId: "u_legacy",
      teamId: null,
      storageKey: "legacy.png",
      storageNodeId: null,
      relativePath: null,
    });

    const response = await DELETE(
      new Request("https://example.com/api/images/img_legacy", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "img_legacy" }) },
    );

    expect(response.status).toBe(403);
    expect(imageDeleteMock).not.toHaveBeenCalled();
  });

  it("skips storage cascade when node is outside team scope", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation(
      (_session: unknown, permission: string) => permission === "image:write",
    );
    imageFindUniqueMock.mockResolvedValueOnce({
      id: "img_1",
      userId: "u_1",
      teamId: "team_1",
      storageKey: "img.png",
      storageNodeId: "node_foreign",
      relativePath: "album/img.png",
      ...imageGeneration,
    });
    storageFindManyMock.mockResolvedValueOnce([]);
    unlinkMock.mockResolvedValue(undefined);
    imageDeleteMock.mockResolvedValueOnce({ id: "img_1" });

    const response = await DELETE(
      new Request("https://example.com/api/images/img_1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "img_1" }) },
    );

    expect(response.status).toBe(200);
    expect(mediaDeleteManyMock).not.toHaveBeenCalled();
    expect(fileDeleteManyMock).not.toHaveBeenCalled();
    expect(imageDeleteMock).toHaveBeenCalledWith({ where: { id: "img_1" } });
  });
});
