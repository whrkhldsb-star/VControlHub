import { beforeEach, describe, expect, it, vi } from "vitest";

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
    storageNode: {
      findFirst: vi.fn(async (args: { where?: { id?: string } } = {}) => ({ id: args.where?.id ?? "node-1" })),
      findMany: vi.fn(async (args: { where?: { id?: { in?: string[] } } } = {}) => {
        const ids = args.where?.id?.in ?? ["node-1"];
        return ids.map((id: string) => ({ id }));
      }),
    },
  },
}));

vi.mock("@/lib/auth/team-scope", () => ({
  teamWhere: (session: { roles?: string[]; currentTeamId?: string | null }) => {
    if (session.roles?.includes("admin")) return {};
    if (session.currentTeamId) {
      return { OR: [{ teamId: session.currentTeamId }, { teamId: null }] };
    }
    return { teamId: null };
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
  beforeEach(() => {
    vi.mocked(prisma.storageNode.findFirst).mockResolvedValue({ id: "node-1" } as never);
    vi.mocked(prisma.storageNode.findMany).mockImplementation((async (args?: any) => {
      const ids = args?.where?.id?.in ?? ["node-1"];
      return ids.map((id: string) => ({ id }));
    }) as never);
  });

  it("denies access when storage node is outside team scope", async () => {
    vi.mocked(prisma.storageNode.findFirst).mockResolvedValueOnce(null as never);
    await expect(assertStorageAccess({
      session: { ...baseSession, currentTeamId: "team-a", roles: ["operator"] },
      storageNodeId: "foreign-node",
      relativePath: "docs/a.txt",
      operation: "read",
    })).resolves.toMatchObject({ allowed: false });
    expect(prisma.userStorageAccess.findMany).not.toHaveBeenCalled();
  });

  it("denies role-based storage access when no explicit grants exist", async () => {
    vi.mocked(prisma.storageNode.findFirst).mockResolvedValueOnce({ id: "node-1" } as never);
    vi.mocked(prisma.userStorageAccess.findMany).mockResolvedValueOnce([]);

    await expect(assertStorageAccess({
      session: baseSession,
      storageNodeId: "node-1",
      relativePath: "docs/a.txt",
      operation: "read",
    })).resolves.toMatchObject({ allowed: false, reason: "No access authorization for this storage node or path" });
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
    })).resolves.toMatchObject({ allowed: false, reason: "Write will exceed the capacity quota of this authorization" });
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
