// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getFilesListing } from "../listing-service";
import { listFilesQuerySchema } from "../schema";
import type { SessionPayload } from "@/lib/auth/session";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("file listing grant boundary", () => {
  const id = `listing-grant-${randomUUID()}`;
  const session: SessionPayload = { userId: id, username: id, roles: [], permissions: ["storage:read"], currentTeamId: id, mustChangePassword: false };
  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!/audit|test|_ci/.test(db.pathname) || !["localhost", "127.0.0.1", "[::1]"].includes(db.hostname)) throw new Error("Disposable DB required");
    await prisma.team.create({ data: { id, name: id, slug: id } });
    await prisma.user.create({ data: { id, username: id, passwordHash: "test-no-login" } });
    await prisma.storageNode.create({ data: { id, name: id, driver: "LOCAL", basePath: "/nonexistent-audit-root", teamId: id } });
    await prisma.userStorageAccess.create({ data: { userId: id, storageNodeId: id, pathPrefix: "public/nested", canRead: true } });
    await prisma.fileEntry.createMany({ data: [
      { storageNodeId: id, relativePath: "public/nested/visible.txt", name: "visible.txt", entryType: "FILE", size: BigInt(1) },
      { storageNodeId: id, relativePath: "public/secret.txt", name: "secret.txt", entryType: "FILE", size: BigInt(2) },
      { storageNodeId: id, relativePath: "secret/private.txt", name: "private.txt", entryType: "FILE", size: BigInt(3) },
    ] });
  });
  afterAll(async () => { await prisma.storageNode.deleteMany({ where: { id } }); await prisma.user.deleteMany({ where: { id } }); await prisma.team.deleteMany({ where: { id } }); await prisma.$disconnect(); });
  it("filters recursive results, totals and node counts before pagination", async () => {
    const { listing } = await getFilesListing(session, listFilesQuerySchema.parse({ nodeId: id, q: ".txt", scope: "all", sync: "0", pageSize: 1 }));
    expect(listing.files.map((row) => row.name)).toEqual(["visible.txt"]);
    expect(listing.pagination.totalItems).toBe(1);
    expect(listing.stats.totalEntries).toBe(1);
    expect(listing.nodes[0]?.fileCount).toBe(1);
  });
  it("permits traversal to a readable descendant without exposing sibling metadata", async () => {
    const { listing } = await getFilesListing(session, listFilesQuerySchema.parse({ nodeId: id, path: "public", sync: "1" }));
    expect(listing.files).toEqual([]);
    expect(listing.folders.map((row) => row.relativePath)).toEqual(["public/nested"]);
    expect(listing.folders[0]?.fileCount).toBe(1);
    expect(listing.syncWarning).toBeNull();
  });
  it("refuses a forbidden directory before filesystem synchronization", async () => {
    await expect(getFilesListing(session, listFilesQuerySchema.parse({ nodeId: id, path: "secret", sync: "1" }))).rejects.toThrow();
  });
});
