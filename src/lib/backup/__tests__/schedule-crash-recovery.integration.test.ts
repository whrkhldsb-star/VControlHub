// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Crash windows of the two backup schedulers on a real PostgreSQL. A worker
 * that dies after claiming an occurrence must leave it due (not parked on a
 * far-future sentinel) and must not leave a half-created record/job behind; a
 * worker that finishes creates the record and job exactly once.
 *
 * The crash is injected in the job enqueue — the last write — and the caller's
 * own failure bookkeeping is suppressed, which is what a killed process looks
 * like: nothing after the injected point runs.
 */
const hooks = vi.hoisted(() => ({ crashOnEnqueue: false }));

vi.mock("@/lib/job/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/job/service")>();
  return {
    ...actual,
    enqueueJob: vi.fn(async (...args: Parameters<typeof actual.enqueueJob>) => {
      if (hooks.crashOnEnqueue) throw new Error("process killed (injected)");
      return actual.enqueueJob(...args);
    }),
  };
});

import { prisma } from "@/lib/db";
import { dispatchDueSchedule } from "../schedule-service";
import { dispatchDueVpsBackupSchedules } from "../vps-backup-schedule-service";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("backup schedules survive a crash between claim and dispatch", () => {
  const prefix = `sched-crash-${randomUUID()}`;
  const due = new Date(Date.now() - 60_000);

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "not-a-login-hash" } });
    await prisma.server.create({ data: { id: prefix, name: prefix, host: "192.0.2.10", username: "root", tags: [] } });
  });
  beforeEach(() => {
    hooks.crashOnEnqueue = false;
  });
  afterAll(async () => {
    await prisma.job.deleteMany({ where: { createdBy: prefix } });
    await prisma.job.deleteMany({ where: { title: { startsWith: `VPS backup: ${prefix}` } } });
    await prisma.backupRecord.deleteMany({ where: { createdBy: prefix } });
    await prisma.backupSchedule.deleteMany({ where: { createdById: prefix } });
    await prisma.vpsBackupRecord.deleteMany({ where: { serverId: prefix } });
    await prisma.vpsBackupSchedule.deleteMany({ where: { serverId: prefix } });
    await prisma.server.deleteMany({ where: { id: prefix } });
    await prisma.user.deleteMany({ where: { id: prefix } });
    await prisma.$disconnect();
  });

  it("platform schedule: a crash before commit leaves the occurrence due and nothing created; the retry dispatches once", async () => {
    const schedule = await prisma.backupSchedule.create({
      data: { name: `${prefix}-platform`, cronExpression: "0 3 * * *", backupType: "DATABASE", status: "ACTIVE", nextRunAt: due, createdById: prefix },
    });
    hooks.crashOnEnqueue = true;
    await expect(dispatchDueSchedule(schedule)).rejects.toThrow("process killed");
    const afterCrash = await prisma.backupSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(afterCrash.nextRunAt?.getTime()).toBe(due.getTime());
    expect(await prisma.backupRecord.count({ where: { createdBy: prefix } })).toBe(0);

    hooks.crashOnEnqueue = false;
    const [first, second] = await Promise.all([dispatchDueSchedule(afterCrash), dispatchDueSchedule(afterCrash)]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(await prisma.backupRecord.count({ where: { createdBy: prefix } })).toBe(1);
    expect(await prisma.job.count({ where: { createdBy: prefix, type: "backup.create" } })).toBe(1);
    const after = await prisma.backupSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(after.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(after.nextRunAt!.getTime() - Date.now()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    expect(after.runCount).toBe(1);
  });

  it("VPS schedule: a crash before commit leaves the occurrence due (no 2099 sentinel) and nothing created", async () => {
    const schedule = await prisma.vpsBackupSchedule.create({
      data: { serverId: prefix, name: `${prefix}-vps`, cronExpression: "0 4 * * *", backupType: "files", paths: ["/etc"], status: "ACTIVE", nextRunAt: due },
    });
    hooks.crashOnEnqueue = true;
    // A killed process never reaches the caller's failure bookkeeping.
    const bookkeeping = vi.spyOn(prisma.vpsBackupSchedule, "update").mockRejectedValueOnce(new Error("process killed (injected)"));
    await dispatchDueVpsBackupSchedules();
    bookkeeping.mockRestore();
    const afterCrash = await prisma.vpsBackupSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(afterCrash.nextRunAt?.getTime()).toBe(due.getTime());
    expect(await prisma.vpsBackupRecord.count({ where: { serverId: prefix } })).toBe(0);

    hooks.crashOnEnqueue = false;
    await Promise.all([dispatchDueVpsBackupSchedules(), dispatchDueVpsBackupSchedules()]);
    expect(await prisma.vpsBackupRecord.count({ where: { serverId: prefix } })).toBe(1);
    expect(await prisma.job.count({ where: { title: `VPS backup: ${prefix}-vps` } })).toBe(1);
    const after = await prisma.vpsBackupSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(after.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(after.nextRunAt!.getFullYear()).toBeLessThan(2099);
    expect(after).toMatchObject({ lastResult: "DISPATCHED", runCount: 1 });
  });
});
