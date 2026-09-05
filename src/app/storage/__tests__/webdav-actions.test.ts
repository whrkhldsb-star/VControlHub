import { expect, it, vi } from "vitest";
const { create, update, audit } = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue({ id: "dav", name: "DAV", driver: "WEBDAV" }), update: vi.fn(), audit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/authorization", () => ({ requirePermission: vi.fn().mockResolvedValue({ userId: "u", roles: ["admin"] }) }));
vi.mock("@/lib/auth/require-session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: audit }));
vi.mock("@/lib/storage/service", () => ({ createStorageNode: create, updateStorageNode: update }));
vi.mock("@/lib/server/service", () => ({ listServerProfiles: vi.fn() }));
import { createStorageNodeAction, updateStorageNodeAction } from "../actions-nodes";
it("maps web form fields to nested configuration without putting secrets in audit metadata", async () => {
  const form = new FormData();
  Object.entries({ storageNodeId: "dav", name: "DAV", driver: "WEBDAV", basePath: "/", webdavUrl: "https://dav.example.com", webdavAuthType: "basic", webdavUsername: "alice", webdavPassword: "secret" }).forEach(([k, v]) => form.set(k, v));
  await createStorageNodeAction(null, form);
  expect(create.mock.calls[0]?.[0].webdavConfig).toEqual({ url: "https://dav.example.com", authType: "basic", username: "alice", password: "secret" });
  form.set("webdavPassword", "");
  await updateStorageNodeAction(null, form);
  expect(update.mock.calls[0]?.[0]).toMatchObject({ driver: "WEBDAV", webdavConfig: { password: "" } });
  expect(JSON.stringify(audit.mock.calls)).not.toContain("secret");
});
