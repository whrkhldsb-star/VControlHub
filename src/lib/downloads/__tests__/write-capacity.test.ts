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

it("matches grants, replaced files, and quota sums case-insensitively on Windows SFTP nodes", async () => {
  const db = {
    storageNode: { findUnique: vi.fn(async () => ({ driver: "SFTP", basePath: "C:/data", server: { operatingSystem: "WINDOWS" } })) },
    userStorageAccess: { findMany: vi.fn(async () => [{ pathPrefix: "Docs", canWrite: true, quotaBytes: BigInt(100), maxFileBytes: BigInt(50) }]) },
    fileEntry: {
      findFirst: vi.fn(async () => ({ size: BigInt(10) })),
      aggregate: vi.fn(async () => ({ _sum: { size: BigInt(90) } })),
    },
  };
  const input = {
    session: { userId: "member", username: "member", mustChangePassword: false, roles: ["storage_manager" as const], currentTeamId: "team", permissions: ["storage:write"] as ["storage:write"] },
    storageNodeId: "node_win",
    relativePath: "docs/sub",
  };
  await expect(downloadWriteCapacity(input, "Report.txt", db as unknown as Prisma.TransactionClient)).resolves.toEqual({
    remainingBytes: BigInt(20),
    maxFileBytes: BigInt(50),
    replacing: true,
  });
  expect(db.fileEntry.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({
      relativePath: { equals: "docs/sub/Report.txt", mode: "insensitive" },
    }),
  }));
  expect(db.fileEntry.aggregate).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({
      OR: [
        { relativePath: { equals: "Docs", mode: "insensitive" } },
        { relativePath: { startsWith: "Docs/", mode: "insensitive" } },
      ],
    }),
  }));
});
