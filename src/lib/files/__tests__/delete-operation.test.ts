// @vitest-environment node
import { it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  first: vi.fn(),
  update: vi.fn(),
  access: vi.fn(),
  lock: vi.fn(),
  shares: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    fileEntry: { findFirst: mocks.first, update: mocks.update },
    shareLink: { findMany: mocks.shares, updateMany: vi.fn() },
    $transaction: async (ops: unknown[]) => Promise.all(ops),
  },
}));
vi.mock("@/lib/auth/team-scope", () => ({
  teamWhere: () => ({ teamId: "team" }),
}));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: mocks.access,
}));
vi.mock("@/lib/concurrency/advisory-lock", () => ({
  tryAcquireAdvisoryLock: mocks.lock,
}));
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
  expect(result.error).toBeTruthy();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(current.isDeleted).toBe(false);
});
