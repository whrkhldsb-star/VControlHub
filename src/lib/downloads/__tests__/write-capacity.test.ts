import type { Prisma } from "@prisma/client";
import { expect, it, vi } from "vitest";
import { downloadWriteCapacity } from "../write-capacity";

it.each([false, true])("checks each enclosing quota and single-file limit independently of grant order (reversed=%s)", async reversed => {
  const grant = (pathPrefix: string, quota: number | null, maxFile: number | null) => ({
    pathPrefix, canWrite: true, quotaBytes: quota === null ? null : BigInt(quota), maxFileBytes: maxFile === null ? null : BigInt(maxFile),
  });
  const grants = [grant("", null, null), grant("parent", 100, 80), grant("parent/child", 60, 40), grant("sibling", 1, 1)];
  const db = {
    userStorageAccess: { findMany: vi.fn(async () => reversed ? grants.reverse() : grants) },
    fileEntry: {
      findFirst: vi.fn(async () => ({ size: BigInt(5) })),
      aggregate: vi.fn(async ({ where }) => ({ _sum: { size: BigInt(where.OR[0].relativePath === "parent" ? 90 : 35) } })),
    },
  };
  const input = { session: { userId: "member", username: "member", mustChangePassword: false, roles: ["storage_manager" as const], currentTeamId: "team", permissions: ["storage:write"] as ["storage:write"] },
    storageNodeId: "node", relativePath: "parent/child" };
  await expect(downloadWriteCapacity(input, "file", db as unknown as Prisma.TransactionClient)).resolves.toEqual({
    remainingBytes: BigInt(15), maxFileBytes: BigInt(40), replacing: true,
  });
  expect(db.fileEntry.aggregate).toHaveBeenCalledTimes(2);
});
