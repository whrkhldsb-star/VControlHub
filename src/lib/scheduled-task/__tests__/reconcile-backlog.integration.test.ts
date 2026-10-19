// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { reconcileScheduledTaskRuns } from "../service";

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
});
