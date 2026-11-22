// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { dispatchDueSchedule, updateBackupSchedule } from "../schedule-service";
import { updateVpsBackupSchedule } from "../vps-backup-schedule-service";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("concurrent VPS schedule edits", () => {
  const id = randomUUID();
  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) throw new Error("requires an isolated test database");
    await prisma.server.create({ data: { id, name: id, username: "test", host: "localhost" } });
    await prisma.vpsBackupSchedule.create({ data: { id, serverId: id, name: id, status: "PAUSED",
      cronExpression: "0 2 * * *", backupType: "website-files", paths: ["/srv/www"] } });
  });
  afterAll(async () => {
    await prisma.server.deleteMany({ where: { id } });
    await prisma.$disconnect();
  });
  it("keeps a platform schedule runnable after concurrent pause and activation", async () => {
    await prisma.backupSchedule.create({ data: { id, name: id, status: "ACTIVE", backupType: "FILES", cronExpression: "0 2 * * *", nextRunAt: new Date(Date.now() + 86_400_000) } });
    try {
      await Promise.all([updateBackupSchedule(id, { status: "PAUSED" }), updateBackupSchedule(id, { status: "ACTIVE" })]);
      const row = await prisma.backupSchedule.findUniqueOrThrow({ where: { id } });
      expect(row.nextRunAt !== null).toBe(row.status === "ACTIVE");
      expect((await updateBackupSchedule(id, { status: "ACTIVE" })).nextRunAt).toBeInstanceOf(Date);
      const stranded = await prisma.backupSchedule.update({ where: { id }, data: { nextRunAt: null } });
      expect(await dispatchDueSchedule(stranded)).toBeNull();
      expect(await prisma.backupSchedule.findUniqueOrThrow({ where: { id } })).toMatchObject({ nextRunAt: expect.any(Date), runCount: 0 });
    } finally {
      await prisma.backupSchedule.delete({ where: { id } });
    }
  });

  it("merges a rename with resume, and validates the final type and paths under contention", async () => {
    await Promise.all([updateVpsBackupSchedule(id, id, { name: "New" }), updateVpsBackupSchedule(id, id, { status: "ACTIVE" })]);
    expect(await prisma.vpsBackupSchedule.findUniqueOrThrow({ where: { id } })).toMatchObject({ name: "New", status: "ACTIVE", nextRunAt: expect.any(Date) });
    const results = await Promise.allSettled([updateVpsBackupSchedule(id, id, { paths: [] }), updateVpsBackupSchedule(id, id, { backupType: "custom" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const row = await prisma.vpsBackupSchedule.findUniqueOrThrow({ where: { id } });
    expect(row.backupType !== "custom" || row.paths.length > 0).toBe(true);
  });
});
