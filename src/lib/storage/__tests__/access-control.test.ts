import { describe, expect, it, vi } from "vitest";

import {
  assertStorageAccess,
  getStorageAccessCapabilities,
  parseNullableBigIntInput,
} from "../access-control";
import type { SessionPayload } from "@/lib/auth/session";

vi.mock("@/lib/db", () => ({
  prisma: {
    userStorageAccess: { findMany: vi.fn() },
    fileEntry: { findMany: vi.fn(), aggregate: vi.fn() },
  },
}));

const { prisma } = await import("@/lib/db");

const baseSession = {
  userId: "user-1",
  username: "alice",
  roles: ["operator"],
  mustChangePassword: false,
  currentTeamId: null,
} satisfies SessionPayload;

describe("storage access control", () => {
  it("denies role-based storage access when no explicit grants exist", async () => {
    vi.mocked(prisma.userStorageAccess.findMany).mockResolvedValueOnce([]);

    await expect(assertStorageAccess({
      session: baseSession,
      storageNodeId: "node-1",
      relativePath: "docs/a.txt",
      operation: "read",
    })).resolves.toMatchObject({ allowed: false, reason: "没有该存储节点或路径的访问授权" });
  });

  it("allows no-grant role-based access only when the legacy fallback flag is enabled", async () => {
    const previous = process.env.VCONTROLHUB_STORAGE_GRANT_FALLBACK;
    process.env.VCONTROLHUB_STORAGE_GRANT_FALLBACK = "true";
    vi.mocked(prisma.userStorageAccess.findMany).mockResolvedValueOnce([]);

    try {
      await expect(assertStorageAccess({
        session: baseSession,
        storageNodeId: "node-1",
        relativePath: "docs/a.txt",
        operation: "read",
      })).resolves.toMatchObject({ allowed: true });
    } finally {
      if (previous === undefined) {
        delete process.env.VCONTROLHUB_STORAGE_GRANT_FALLBACK;
      } else {
        process.env.VCONTROLHUB_STORAGE_GRANT_FALLBACK = previous;
      }
    }
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
    vi.mocked(prisma.fileEntry.aggregate).mockResolvedValueOnce({ _sum: { size: BigInt(50) } } as Awaited<ReturnType<typeof prisma.fileEntry.aggregate>>);

    await expect(assertStorageAccess({
      session: baseSession,
      storageNodeId: "node-1",
      relativePath: "team-a/new.txt",
      operation: "write",
      writeBytes: 55,
    })).resolves.toMatchObject({ allowed: false, reason: "写入后将超过该授权的容量配额" });
    expect(prisma.fileEntry.aggregate).toHaveBeenCalledWith({
      where: {
        storageNodeId: "node-1",
        isDeleted: false,
        entryType: "FILE",
        OR: [
          { relativePath: "team-a" },
          { relativePath: { startsWith: "team-a/" } },
        ],
      },
      _sum: { size: true },
    });
    expect(prisma.fileEntry.findMany).not.toHaveBeenCalled();
  });

  it("computes per-entry capabilities from explicit storage grants", async () => {
    vi.mocked(prisma.userStorageAccess.findMany).mockResolvedValueOnce([
      {
        id: "grant-read-write",
        userId: "user-1",
        storageNodeId: "node-1",
        pathPrefix: "team-a",
        canRead: true,
        canWrite: true,
        canDelete: false,
        quotaBytes: null,
        maxFileBytes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "grant-delete",
        userId: "user-1",
        storageNodeId: "node-1",
        pathPrefix: "team-a/archive",
        canRead: false,
        canWrite: false,
        canDelete: true,
        quotaBytes: null,
        maxFileBytes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await expect(getStorageAccessCapabilities({
      session: { ...baseSession, roles: ["operator"] },
      targets: [
        { storageNodeId: "node-1", relativePath: "team-a/report.txt" },
        { storageNodeId: "node-1", relativePath: "team-a/archive/old.zip" },
        { storageNodeId: "node-1", relativePath: "team-b/private.txt" },
      ],
    })).resolves.toEqual(new Map([
      ["node-1:team-a/report.txt", { canRead: true, canWrite: true, canDelete: false }],
      ["node-1:team-a/archive/old.zip", { canRead: true, canWrite: true, canDelete: false }],
      ["node-1:team-b/private.txt", { canRead: false, canWrite: false, canDelete: false }],
    ]));
  });

  it("parses nullable bigint inputs safely", () => {
    expect(parseNullableBigIntInput("1024")).toBe(BigInt(1024));
    expect(parseNullableBigIntInput(12.8)).toBe(BigInt(12));
    expect(parseNullableBigIntInput("")).toBeNull();
    expect(parseNullableBigIntInput("bad")).toBeNull();
  });
});
