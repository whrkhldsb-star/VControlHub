// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SessionPayload } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";

import { assertStorageAccess, releaseStorageQuotaGuard } from "../access-control";
import { restoreFileVersion, snapshotFileVersionBeforeOverwrite } from "../file-versions";

/**
 * Grant limits on a real PostgreSQL index and a real LOCAL storage directory.
 * A version restore is a write and must obey the grant's current maxFileBytes
 * and quota; an overwrite is charged only its size change, so a full quota
 * still admits a same-size or smaller rewrite of an existing file.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("storage grant limits on overwrite and version restore", () => {
  const prefix = `quota-${randomUUID()}`;
  let root: string;
  const session = {
    userId: prefix,
    username: prefix,
    roles: [],
    permissions: ["storage:read", "storage:write"],
    mustChangePassword: false,
    currentTeamId: prefix,
  } satisfies SessionPayload;

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    root = mkdtempSync(join(tmpdir(), "vch-quota-"));
    await prisma.team.create({ data: { id: prefix, name: prefix, slug: prefix } });
    await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "not-a-login-hash" } });
    await prisma.storageNode.create({ data: { id: prefix, name: prefix, driver: "LOCAL", basePath: root, teamId: prefix } });
  });
  afterAll(async () => {
    await prisma.fileVersion.deleteMany({ where: { fileEntry: { storageNodeId: prefix } } });
    await prisma.fileEntry.deleteMany({ where: { storageNodeId: prefix } });
    await prisma.userStorageAccess.deleteMany({ where: { storageNodeId: prefix } });
    await prisma.storageNode.deleteMany({ where: { id: prefix } });
    await prisma.user.deleteMany({ where: { id: prefix } });
    await prisma.team.deleteMany({ where: { id: prefix } });
    rmSync(root, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  async function grant(pathPrefix: string, limits: { quotaBytes?: number; maxFileBytes?: number }) {
    await prisma.userStorageAccess.deleteMany({ where: { storageNodeId: prefix } });
    await prisma.userStorageAccess.create({
      data: {
        userId: prefix,
        storageNodeId: prefix,
        pathPrefix,
        canRead: true,
        canWrite: true,
        canDelete: false,
        quotaBytes: limits.quotaBytes == null ? null : BigInt(limits.quotaBytes),
        maxFileBytes: limits.maxFileBytes == null ? null : BigInt(limits.maxFileBytes),
      },
    });
  }
  async function file(relativePath: string, bytes: number) {
    writeFileSync(join(root, relativePath), "x".repeat(bytes));
    return prisma.fileEntry.upsert({
      where: { storageNodeId_relativePath: { storageNodeId: prefix, relativePath } },
      create: { storageNodeId: prefix, relativePath, name: relativePath.split("/").pop()!, entryType: "FILE", size: BigInt(bytes) },
      update: { size: BigInt(bytes), isDeleted: false },
    });
  }
  const write = async (relativePath: string, writeBytes: number) => {
    const decision = await assertStorageAccess({ session, storageNodeId: prefix, relativePath, operation: "write", writeBytes });
    await releaseStorageQuotaGuard(decision);
    return decision.allowed ? "allowed" : decision.reason;
  };

  it("restoring a version larger than the grant's current maxFileBytes is refused and leaves the file as is", async () => {
    mkdirSync(join(root, "r"), { recursive: true });
    const entry = await file("r/report.txt", 500);
    const big = await snapshotFileVersionBeforeOverwrite({ fileEntryId: entry.id, userId: prefix, reason: "MANUAL" });
    expect(big).not.toBeNull();
    await file("r/report.txt", 10);
    // An administrator lowers the limit after the 500-byte version was taken.
    await grant("r", { maxFileBytes: 100 });

    await expect(restoreFileVersion({ fileEntryId: entry.id, versionId: big!.id, session })).rejects.toBeInstanceOf(ForbiddenError);
    expect(readFileSync(join(root, "r/report.txt"), "utf8")).toBe("x".repeat(10));
    expect((await prisma.fileEntry.findUniqueOrThrow({ where: { id: entry.id } })).size).toBe(BigInt(10));
  });

  it("restoring a version that would exceed the grant quota is refused; one that fits is applied", async () => {
    mkdirSync(join(root, "q"), { recursive: true });
    const entry = await file("q/doc.txt", 80);
    const v80 = await snapshotFileVersionBeforeOverwrite({ fileEntryId: entry.id, userId: prefix, reason: "MANUAL" });
    await file("q/doc.txt", 20);
    await file("q/other.txt", 50);
    await grant("q", { quotaBytes: 100 });
    // usage 70; restoring 80 over the 20-byte file grows it by 60 -> 130 > 100
    await expect(restoreFileVersion({ fileEntryId: entry.id, versionId: v80!.id, session })).rejects.toBeInstanceOf(ForbiddenError);
    expect(readFileSync(join(root, "q/doc.txt"), "utf8")).toBe("x".repeat(20));

    await prisma.fileEntry.updateMany({ where: { storageNodeId: prefix, relativePath: "q/other.txt" }, data: { isDeleted: true } });
    // usage 20; growing to 80 -> 80 <= 100
    await restoreFileVersion({ fileEntryId: entry.id, versionId: v80!.id, session });
    expect(readFileSync(join(root, "q/doc.txt"), "utf8")).toBe("x".repeat(80));
  });

  it("a full quota admits a same-size or smaller overwrite but nothing that grows usage", async () => {
    mkdirSync(join(root, "f"), { recursive: true });
    await file("f/a.txt", 60);
    await file("f/b.txt", 40);
    await grant("f", { quotaBytes: 100 });

    expect(await write("f/a.txt", 60)).toBe("allowed");
    expect(await write("f/a.txt", 30)).toBe("allowed");
    expect(await write("f/a.txt", 61)).toBe("quota_exceeded");
    expect(await write("f/new.txt", 1)).toBe("quota_exceeded");
    // A directory target (upload admission) is not a replaced file.
    expect(await write("f", 1)).toBe("quota_exceeded");
  });
});
