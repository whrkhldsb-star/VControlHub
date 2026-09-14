import { beforeEach, describe, expect, it, vi } from "vitest";
const { db } = vi.hoisted(() => ({ db: { storageNode: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() }, server: { findFirst: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ prisma: db, isUniqueViolation: () => false }));
vi.mock("@/lib/ssh/client", () => ({ listRemoteDirectory: vi.fn() }));
vi.mock("@/lib/crypto/service", () => ({ encrypt: (v: string) => `encrypted:${v}`, decrypt: (v: string) => v.slice(10) }));
import { createStorageNodeSchema, updateStorageNodeSchema } from "../schema";
import { createStorageNode, updateStorageNode, listStorageNodes } from "../service-nodes";
const config = { url: "https://dav.example.com/root", authType: "basic" as const, username: "alice", password: "secret" };
const input = { name: "DAV node", driver: "WEBDAV" as const, basePath: "/", webdavConfig: config };
const row = { id: "dav1", ...input, isDefault: false, serverId: null, server: null, fileEntries: [], _count: { fileEntries: 0 }, webdavConfigEncrypted: `encrypted:${JSON.stringify(config)}` };
beforeEach(() => { vi.clearAllMocks(); db.storageNode.create.mockImplementation(async ({ data }) => ({ ...row, ...data })); db.storageNode.findUnique.mockResolvedValue(row); db.storageNode.findFirst.mockResolvedValue(row); db.storageNode.updateMany.mockResolvedValue({ count: 1 }); });
describe("WebDAV node configuration boundary", () => {
  it.each(["http://dav.example.com", "https://user:secret@dav.example.com", "https://dav.example.com/?token=x", "https://dav.example.com/#secret"])("rejects unsafe endpoint %s", (url) => {
    expect(createStorageNodeSchema.safeParse({ ...input, webdavConfig: { ...config, url } }).success).toBe(false);
  });
  it("requires config and forbids VPS binding / direct access", () => {
    expect(createStorageNodeSchema.safeParse({ ...input, webdavConfig: undefined }).success).toBe(false);
    expect(createStorageNodeSchema.safeParse({ ...input, serverId: "vps" }).success).toBe(false);
    expect(createStorageNodeSchema.safeParse({ ...input, directAccessMode: "DIRECT" }).success).toBe(false);
  });
  it("allows blank secrets in update schema", () => {
    expect(updateStorageNodeSchema.parse({ storageNodeId: "dav1", webdavConfig: { ...config, password: "" } })).toHaveProperty("webdavConfig");
  });
  it("encrypts config and omits secrets from create/list DTOs", async () => {
    const result = await createStorageNode(input);
    expect(db.storageNode.create.mock.calls[0]![0].data.webdavConfigEncrypted).toBe(`encrypted:${JSON.stringify(config)}`);
    expect(result).not.toHaveProperty("webdavConfigEncrypted");
    expect(result).not.toHaveProperty("password");
    db.storageNode.findMany.mockResolvedValue([row]);
    const [dto] = await listStorageNodes();
    expect(db.storageNode.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      include: expect.objectContaining({ _count: { select: { fileEntries: { where: { isDeleted: false } } } } }),
    }));
    expect(db.storageNode.findMany.mock.calls.at(-1)![0].include).not.toHaveProperty("fileEntries");
    expect(dto).not.toHaveProperty("webdavConfigEncrypted");
    expect(dto?.webdavConfig).toEqual({ url: config.url, authType: "basic", username: "alice", hasPassword: true, hasToken: false });
  });
  it("preserves same-auth blank secrets and redacts update DTO", async () => {
    const result = await updateStorageNode({ storageNodeId: "dav1", webdavConfig: { ...config, password: "" } });
    expect(JSON.parse(db.storageNode.updateMany.mock.calls[0]![0].data.webdavConfigEncrypted.slice(10)).password).toBe("secret");
    expect(result).not.toHaveProperty("webdavConfigEncrypted");
  });
  it("rejects VPS binding when driver omitted", async () => {
    await expect(updateStorageNode({ storageNodeId: "dav1", serverId: "vps" })).rejects.toThrow();
  });
  it("does not reuse a basic secret for bearer auth", async () => {
    await expect(updateStorageNode({ storageNodeId: "dav1", webdavConfig: { url: config.url, authType: "bearer", token: "" } })).rejects.toThrow();
  });
  it("clears encrypted configuration on driver switch", async () => {
    await updateStorageNode({ storageNodeId: "dav1", driver: "LOCAL" });
    expect(db.storageNode.updateMany.mock.calls[0]![0].data.webdavConfigEncrypted).toBeNull();
  });
});
