// @vitest-environment node
import { it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  first: vi.fn(),
  children: vi.fn(),
  stat: vi.fn(),
  agent: vi.fn(),
  update: vi.fn(),
  access: vi.fn(),
  lock: vi.fn(),
  lockPath: vi.fn(async () => async () => {}),
  shares: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    fileEntry: { findFirst: mocks.first, findMany: mocks.children, update: mocks.update },
    shareLink: { findMany: mocks.shares, updateMany: vi.fn() },
    $transaction: async (ops: unknown[]) => Promise.all(ops),
  },
}));
vi.mock("@/lib/auth/team-scope", () => ({
  teamWhere: () => ({ teamId: "team" }),
}));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: mocks.access,
  getStorageAccessCapabilities: async () => new Map([["docs/item", { canDelete: true }]]),
  getStorageAccessCapabilityKey: ({ relativePath }: { relativePath: string }) => relativePath,
}));
vi.mock("@/lib/storage/file-overwrite-lock", () => ({ lockStorageFileOverwrite: mocks.lockPath }));
vi.mock("@/lib/concurrency/advisory-lock", () => ({
  tryAcquireAdvisoryLock: mocks.lock,
}));
vi.mock("@/lib/storage/agent-file-client", () => ({ createAgentFileClient: mocks.agent }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: vi.fn() }));
import { executeDeleteFile } from "../delete-operation";
it("delete must reauthorize the path changed before acquiring lock", async () => {
  const current = {
    id: "file",
    name: "secret.txt",
    relativePath: "allowed/secret.txt",
    entryType: "FILE",
    storageNodeId: "node",
    isDeleted: false,
  };
  mocks.first.mockImplementation(async () => ({ ...current }));
  mocks.lock.mockImplementation(async () => {
    current.relativePath = "restricted/secret.txt";
    return async () => {};
  });
  mocks.access.mockImplementation(async ({ relativePath }) => ({
    allowed: relativePath.startsWith("allowed/"),
  }));
  mocks.shares.mockResolvedValue([]);
  mocks.update.mockImplementation(async ({ where, data }) => {
    if (where.id === current.id) Object.assign(current, data);
    return { ...current };
  });
  const form = new FormData();
  form.set("fileEntryId", "file");
  const result = await executeDeleteFile(
    { userId: "user", currentTeamId: "team", roles: ["operator"] } as never,
    form,
  );
  expect(mocks.lockPath).toHaveBeenCalledWith("node", "allowed/secret.txt");
  expect(result.error).toBeTruthy();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(current.isDeleted).toBe(false);
});

it("pins each recycled agent descendant to its own version in the original root", async () => {
  vi.clearAllMocks();
  const root = {
    id: "folder", storageNodeId: "node", relativePath: "docs", entryType: "DIRECTORY", updatedAt: new Date(1),
    storageNode: { driver: "AGENT", agentFileShare: { rootIdentity: "v2:original" } },
  };
  const child = { id: "child", relativePath: "docs/item", entryType: "FILE", updatedAt: new Date(2) };
  mocks.first.mockResolvedValue(root);
  mocks.children.mockResolvedValue([child]);
  mocks.lock.mockResolvedValue(async () => {});
  mocks.access.mockResolvedValue({ allowed: true });
  mocks.shares.mockResolvedValue([]);
  mocks.update.mockResolvedValue({});
  mocks.agent.mockReturnValue({ stat: mocks.stat });
  mocks.stat.mockResolvedValueOnce({ etag: "dir-version", isDirectory: true }).mockResolvedValueOnce({ etag: "child-version", isDirectory: false });
  const form = new FormData();
  form.set("fileEntryId", root.id);
  const result = await executeDeleteFile({ userId: "u", currentTeamId: "team" } as never, form);
  expect(result.success).toBeTruthy();
  expect(mocks.agent).toHaveBeenCalledWith("node", undefined, "v2:original");
  const [childUpdate, rootUpdate] = mocks.update.mock.calls.map(([update]) => update);
  expect(childUpdate.where).toMatchObject({ id: child.id, updatedAt: child.updatedAt, isDeleted: false });
  expect(childUpdate.data).toMatchObject({ deletedAgentRoot: "v2:original", storageVersion: "child-version", deleteBatchId: rootUpdate.data.deleteBatchId });
  expect(rootUpdate.data.storageVersion).toBe("dir-version");
});
