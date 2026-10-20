// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { reconcileScheduledTaskRuns, updateScheduledTask } from "../service";

/**
 * Finished scheduled runs are summarised even behind a backlog of runs still
 * waiting for approval: the batch used to be the oldest DISPATCHED runs,
 * whatever their request's state, so a full batch of pending approvals hid
 * every finished result behind it.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("scheduled run reconcile behind an approval backlog (PostgreSQL)", () => {
  const prefix = `sched-rec-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "not-a-login-hash" } });
  });
  afterAll(async () => {
    await prisma.scheduledTask.deleteMany({ where: { createdById: prefix } });
    await prisma.commandRequest.deleteMany({ where: { requesterId: prefix } });
    await prisma.user.delete({ where: { id: prefix } });
    await prisma.$disconnect();
  });

  it("reconciles a finished run that sorts after a full batch of pending approvals", async () => {
    const task = await prisma.scheduledTask.create({
      data: { name: prefix, cronExpression: "0 * * * *", command: "uptime", serverIds: ["srv"], createdById: prefix, status: "ACTIVE" },
    });
    const base = Date.now() - 3_600_000;
    for (let i = 0; i < 4; i += 1) {
      const finished = i === 3;
      const request = await prisma.commandRequest.create({
        data: { title: `${prefix}-${i}`, command: "uptime", initiatedByType: "USER", requesterId: prefix, status: finished ? "COMPLETED" : "PENDING_APPROVAL" },
      });
      await prisma.scheduledTaskRun.create({
        data: { scheduledTaskId: task.id, commandRequestId: request.id, dispatchedAt: new Date(base + i * 60_000) },
      });
    }
    // A batch of 3: exactly the three older pending approvals.
    const result = await reconcileScheduledTaskRuns(3);
    expect(result.reconciled).toBe(1);
    const runs = await prisma.scheduledTaskRun.findMany({ where: { scheduledTaskId: task.id }, orderBy: { dispatchedAt: "asc" } });
    expect(runs.map((run) => run.status)).toEqual(["DISPATCHED", "DISPATCHED", "DISPATCHED", "COMPLETED"]);
  });

  it("records a run's outcome again after the task summary failed to save", async () => {
    // The run was marked finished, then the summary write failed: the run left
    // the DISPATCHED scan for good and the task kept "awaiting final result".
    const task = await prisma.scheduledTask.create({
      data: { name: `${prefix}-summary`, cronExpression: "0 * * * *", command: "uptime", serverIds: ["srv"], createdById: prefix, status: "ACTIVE", lastResult: "awaiting final result" },
    });
    const request = await prisma.commandRequest.create({
      data: { title: `${prefix}-summary`, command: "uptime", initiatedByType: "USER", requesterId: prefix, status: "COMPLETED" },
    });
    await prisma.scheduledTaskRun.create({ data: { scheduledTaskId: task.id, commandRequestId: request.id } });
    // One failure of the summary write for this task.
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "vch_test_fail_once" (task_id text PRIMARY KEY)`);
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION vch_test_fail_summary() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM "vch_test_fail_once" WHERE task_id = NEW.id) THEN
          RAISE EXCEPTION 'injected summary failure';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER vch_test_fail_summary BEFORE UPDATE OF "lastResult" ON scheduled_tasks FOR EACH ROW EXECUTE FUNCTION vch_test_fail_summary()`);
    try {
      await prisma.$executeRaw`INSERT INTO "vch_test_fail_once" (task_id) VALUES (${task.id})`;
      await reconcileScheduledTaskRuns(10);
      expect((await prisma.scheduledTaskRun.findFirstOrThrow({ where: { scheduledTaskId: task.id } })).status).toBe("DISPATCHED");

      await prisma.$executeRaw`DELETE FROM "vch_test_fail_once" WHERE task_id = ${task.id}`;
      await reconcileScheduledTaskRuns(10);
      expect((await prisma.scheduledTaskRun.findFirstOrThrow({ where: { scheduledTaskId: task.id } })).status).toBe("COMPLETED");
      expect((await prisma.scheduledTask.findUniqueOrThrow({ where: { id: task.id } })).lastResult).toBe(`Completed command request ${request.id}`);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS vch_test_fail_summary ON scheduled_tasks`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS vch_test_fail_summary()`);
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "vch_test_fail_once"`);
    }
  });

  it("resuming a paused task through an edit schedules its next run, as the toggle does", async () => {
    const session = { userId: prefix, roles: ["admin" as const], currentTeamId: null };
    const task = await prisma.scheduledTask.create({
      data: { name: `${prefix}-resume`, cronExpression: "0 * * * *", command: "uptime", serverIds: ["srv"], createdById: prefix, status: "ACTIVE", nextRunAt: new Date(Date.now() + 3_600_000) },
    });
    const paused = await updateScheduledTask(task.id, { status: "PAUSED" }, session);
    expect(paused).toMatchObject({ status: "PAUSED", nextRunAt: null });
    const resumed = await updateScheduledTask(task.id, { status: "ACTIVE" }, session);
    expect(resumed.status).toBe("ACTIVE");
    expect(resumed.nextRunAt).not.toBeNull();
    expect(resumed.nextRunAt!.getTime()).toBeGreaterThan(Date.now());

    // A one-off task whose time has passed still cannot resume.
    const once = await prisma.scheduledTask.create({
      data: { name: `${prefix}-once`, cronExpression: "0 0 1 1 *", scheduleType: "ONCE", runAt: new Date(Date.now() - 60_000), command: "uptime", serverIds: ["srv"], createdById: prefix, status: "PAUSED" },
    });
    await expect(updateScheduledTask(once.id, { status: "ACTIVE" }, session)).rejects.toThrow();
  });
});

