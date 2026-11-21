import { beforeEach, describe, expect, it, vi } from "vitest";
const dav = vi.hoisted(() => ({ mkdir: vi.fn(), write: vi.fn(), read: vi.fn(), stat: vi.fn(), delete: vi.fn(), rename: vi.fn() }));
vi.mock("../webdav-client", () => ({ createWebDavClient: vi.fn(() => dav) }));
vi.mock("../agent-file-queue", () => ({ callFileAgent: vi.fn(), getFileChannel: async () => ({}) }));
import { callFileAgent } from "../agent-file-queue";
import { createWebDavClient } from "../webdav-client";
import { createManagedFolder, writeBackingObject, readBackingObject, statBackingObject, deleteBackingObject, renameBackingObject, moveBackingObject } from "../fs-backend";
const storageNode = { driver: "WEBDAV", basePath: "/root", webdavConfigEncrypted: "encrypted-config", host: null, port: null, username: null, hostKeySha256: null, server: null };
const input = { storageNode, relativePath: "folder/file.txt" };
beforeEach(() => vi.resetAllMocks());
describe("WebDAV filesystem dispatch", () => {
  it("dispatches all backing operations with encrypted node credentials", async () => {
    vi.mocked(createWebDavClient).mockReturnValue(dav as unknown as ReturnType<typeof createWebDavClient>);
    dav.write.mockResolvedValue({ byteSize: 3 });
    dav.read.mockResolvedValue(Buffer.from("abc"));
    dav.stat.mockResolvedValue({ size: 3, lastModifiedMs: 42, isDirectory: false });
    await createManagedFolder(input);
    expect(dav.mkdir).toHaveBeenCalledWith(input.relativePath);
    expect(await writeBackingObject({ ...input, content: "abc" })).toEqual({ byteSize: 3 });
    expect(await readBackingObject({ ...input, maxBytes: 3 })).toEqual(Buffer.from("abc"));
    expect(dav.read).toHaveBeenCalledWith(input.relativePath, 3);
    expect(await statBackingObject(input)).toEqual({ size: 3, lastModifiedMs: 42, isDirectory: false });
    await deleteBackingObject({ ...input, isDirectory: false, tolerateMissing: false });
    expect(dav.delete).toHaveBeenCalledWith(input.relativePath);
    const move = { storageNode, oldRelativePath: "old", newRelativePath: "new" };
    await renameBackingObject(move);
    await moveBackingObject(move);
    expect(dav.rename).toHaveBeenCalledTimes(2);
    expect(dav.rename).toHaveBeenCalledWith("old", "new");
    expect(createWebDavClient).toHaveBeenCalledWith(storageNode);
  });
  it("tolerates missing objects only when requested", async () => {
    vi.mocked(createWebDavClient).mockReturnValue(dav as unknown as ReturnType<typeof createWebDavClient>);
    dav.delete.mockRejectedValue(new Error("WebDAV HTTP 404: not found"));
    await expect(deleteBackingObject({ ...input, isDirectory: false, tolerateMissing: true })).resolves.toBeUndefined();
    await expect(deleteBackingObject({ ...input, isDirectory: false, tolerateMissing: false })).rejects.toThrow("404");
    dav.stat.mockResolvedValue(null);
    expect(await statBackingObject(input)).toBeNull();
  });
});

it("requires an exclusive Agent operation for recovery without retrying an old Agent's ordinary rename", async () => {
  vi.mocked(callFileAgent).mockRejectedValueOnce(new Error("operation unsupported"));
  await expect(moveBackingObject({
    storageNode: { ...storageNode, id: "agent", driver: "AGENT" }, oldRelativePath: "staged", newRelativePath: "restored",
  })).rejects.toThrow("operation unsupported");
  expect(vi.mocked(callFileAgent)).toHaveBeenCalledExactlyOnceWith("agent", {}, {
    op: "rename-exclusive", path: "staged", destination: "restored", overwrite: false,
  });
});
