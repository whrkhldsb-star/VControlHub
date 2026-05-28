import { describe, expect, it, vi } from "vitest";

import { assertStorageAccess, parseNullableBigIntInput } from "../access-control";
import type { SessionPayload } from "@/lib/auth/session";

vi.mock("@/lib/db", () => ({
  prisma: {
    userStorageAccess: { findMany: vi.fn() },
    fileEntry: { findMany: vi.fn() },
  },
}));

const { prisma } = await import("@/lib/db");

const baseSession = {
  userId: "user-1",
  username: "alice",
  roles: ["operator"],
  mustChangePassword: false,
} satisfies SessionPayload;

describe("storage access control", () => {
  it("keeps role-based storage access when no explicit grants exist", async () => {
    vi.mocked(prisma.userStorageAccess.findMany).mockResolvedValueOnce([]);

    await expect(assertStorageAccess({
      session: baseSession,
      storageNodeId: "node-1",
      relativePath: "docs/a.txt",
      operation: "read",
    })).resolves.toMatchObject({ allowed: true });
  });

  it("denies paths outside explicit grants", async () => {
    vi.mocked(prisma.userStorageAccess.findMany).mockResolvedValueOnce([
      {
        id: "grant-1",
        userId: "user-1",
        storageNodeId: "node-1",
        pathPrefix: "team-a",
        canRead: true,
        canWrite: false,
        canDelete: false,
        quotaBytes: null,
        maxFileBytes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await expect(assertStorageAccess({
      session: baseSession,
      storageNodeId: "node-1",
      relativePath: "team-a/../secret.txt",
      operation: "read",
    })).resolves.toMatchObject({ allowed: false });
  });

  it("enforces max file size and quota on writes", async () => {
    vi.mocked(prisma.userStorageAccess.findMany).mockResolvedValueOnce([
      {
        id: "grant-1",
        userId: "user-1",
        storageNodeId: "node-1",
        pathPrefix: "team-a",
        canRead: true,
        canWrite: true,
        canDelete: false,
        quotaBytes: BigInt(100),
        maxFileBytes: BigInt(60),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    vi.mocked(prisma.fileEntry.findMany).mockResolvedValueOnce([{ size: BigInt(50) }] as Awaited<ReturnType<typeof prisma.fileEntry.findMany>>);

    await expect(assertStorageAccess({
      session: baseSession,
      storageNodeId: "node-1",
      relativePath: "team-a/new.txt",
      operation: "write",
      writeBytes: 55,
    })).resolves.toMatchObject({ allowed: false, reason: "写入后将超过该授权的容量配额" });
  });

  it("parses nullable bigint inputs safely", () => {
    expect(parseNullableBigIntInput("1024")).toBe(BigInt(1024));
    expect(parseNullableBigIntInput(12.8)).toBe(BigInt(12));
    expect(parseNullableBigIntInput("")).toBeNull();
    expect(parseNullableBigIntInput("bad")).toBeNull();
  });
});
