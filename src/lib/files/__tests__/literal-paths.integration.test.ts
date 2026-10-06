// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { closeAdvisoryLockPoolForTests } from "@/lib/concurrency/advisory-lock";
import type { SessionPayload } from "@/lib/auth/session";
import { getStorageAccessUsage } from "@/lib/storage/access-control";
import { listShareDirectoryFiles } from "@/lib/share-link/service";
import { executeDeleteFile } from "../delete-operation";
import { getRecycleBinPage } from "../recycle-bin";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("literal path boundaries in PostgreSQL", () => {
  const id = `literal-path-audit-${randomUUID()}`;
  const prefix = "目录%_";
  const sibling = "目录AB";
  const session: SessionPayload = { userId: id, username: id, roles: ["admin"], mustChangePassword: false, currentTeamId: id };
  let ready = false;
  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("Literal path integration requires an isolated loopback audit/test database");
    }
    await prisma.user.create({ data: { id, username: id, passwordHash: "unused", status: "ACTIVE" } });
    await prisma.team.create({ data: { id, slug: id, name: id } });
    await prisma.storageNode.create({ data: { id, name: id, teamId: id, driver: "LOCAL", basePath: "/unused-literal-path-test" } });
    await prisma.userStorageAccess.create({ data: { userId: id, storageNodeId: id, pathPrefix: prefix, canRead: true } });
    ready = true;
  });
  beforeEach(async () => {
    await prisma.fileEntry.deleteMany({ where: { storageNodeId: id } });
    await prisma.fileEntry.createMany({ data: [
      { storageNodeId: id, relativePath: prefix, name: prefix, entryType: "DIRECTORY" },
      { storageNodeId: id, relativePath: `${prefix}/own.txt`, name: "own.txt", entryType: "FILE", size: BigInt(10) },
      { storageNodeId: id, relativePath: `${sibling}/private.txt`, name: "private.txt", entryType: "FILE", size: BigInt(999) },
    ] });
  });
  afterAll(async () => {
    if (ready) {
      await prisma.auditLog.deleteMany({ where: { actorId: id } });
      await prisma.storageNode.delete({ where: { id } });
      await prisma.team.delete({ where: { id } });
      await prisma.user.delete({ where: { id } });
    }
    await closeAdvisoryLockPoolForTests();
    await prisma.$disconnect();
  });

  it("does not soft-delete a similarly named sibling directory's files", async () => {
    const entry = await prisma.fileEntry.findUniqueOrThrow({ where: { storageNodeId_relativePath: { storageNodeId: id, relativePath: prefix } } });
    const body = new FormData();
    body.set("fileEntryId", entry.id);
    expect(await executeDeleteFile(session, body, "en")).toMatchObject({ physicalDeleted: false });
    const rows = await prisma.fileEntry.findMany({ where: { storageNodeId: id }, orderBy: { relativePath: "asc" } });
    expect(rows.filter((row) => row.isDeleted).map((row) => row.relativePath)).toEqual([prefix, `${prefix}/own.txt`]);
    expect(rows.find((row) => row.relativePath === `${sibling}/private.txt`)?.isDeleted).toBe(false);
  });

  it("does not expose sibling metadata through a directory share", async () => {
    const files = await listShareDirectoryFiles({ entryType: "DIRECTORY", path: prefix, storageNodeId: id });
    expect(files.map((file) => file.relativePath)).toEqual([`${prefix}/own.txt`]);
  });

  it("applies recycle-bin path grants literally", async () => {
    await prisma.fileEntry.updateMany({ where: { storageNodeId: id, entryType: "FILE" }, data: { isDeleted: true } });
    const page = await getRecycleBinPage({ ...session, roles: ["viewer"] }, { page: 1, pageSize: 50 });
    expect(page.entries.map((file) => file.relativePath)).toEqual([`${prefix}/own.txt`]);
    expect(page.pagination.totalItems).toBe(1);
  });

  it("does not charge sibling bytes against a grant quota", async () => {
    expect(await getStorageAccessUsage({ storageNodeId: id, pathPrefix: prefix })).toBe(BigInt(10));
  });
});
