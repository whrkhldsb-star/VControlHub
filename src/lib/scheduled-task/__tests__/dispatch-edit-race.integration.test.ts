// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * A schedule edited while its occurrence is being dispatched keeps the edit.
 * The dispatch record used to overwrite it: a ONCE task moved to next hour
 * between "command created" and "dispatch recorded" ended up DISABLED with
 * no next run, so the run the user had just scheduled never happened.
 */
const { createCommandRequest } = vi.hoisted(() => ({ createCommandRequest: vi.fn() }));
vi.mock("@/lib/command/service", () => ({ createCommandRequest }));
vi.mock("@/lib/auth/command-execution-authz", () => ({
  assertRequesterMayExecuteCommand: vi.fn(async () => ({ ok: true })),
}));

import { prisma } from "@/lib/db";
import { dispatchDueScheduledTasks } from "../worker";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("scheduled-task edit during dispatch (PostgreSQL)", () => {
  const prefix = `sched-edit-${randomUUID()}`;

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "not-a-login-hash" } });
  });
  afterAll(async () => {
    await prisma.scheduledTaskRun.deleteMany({ where: { scheduledTask: { createdById: prefix } } });
    await prisma.commandRequest.deleteMany({ where: { requesterId: prefix } });
    await prisma.scheduledTask.deleteMany({ where: { createdById: prefix } });
    await prisma.user.delete({ where: { id: prefix } });
    await prisma.$disconnect();
  });

  async function createRequest() {
    return prisma.commandRequest.create({
      data: { title: "t", command: "uptime", reason: "r", requesterId: prefix, initiatedByType: "USER", status: "PENDING_APPROVAL" },
    });
  }

  it("keeps a ONCE task rescheduled while it was being dispatched", async () => {
    const due = new Date(Date.now() - 60_000);
    const later = new Date(Date.now() + 3_600_000);
    const task = await prisma.scheduledTask.create({
      data: { name: `${prefix}-once`, scheduleType: "ONCE", runAt: due, cronExpression: "", command: "uptime", serverIds: ["srv"], createdById: prefix, approvalRequired: true, status: "ACTIVE", nextRunAt: due },
    });
    createCommandRequest.mockImplementationOnce(async () => {
      // What updateScheduledTask writes when the run time is changed.
      await prisma.scheduledTask.update({ where: { id: task.id }, data: { runAt: later, nextRunAt: later, claimedOccurrenceAt: null, status: "ACTIVE" } });
      return createRequest();
    });

    await dispatchDueScheduledTasks("edit-race");

    const after = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.status).toBe("ACTIVE");
    expect(after.nextRunAt?.toISOString()).toBe(later.toISOString());
    expect(after.runCount).toBe(1);
  });

  it("still closes a ONCE task that nobody edited", async () => {
    const due = new Date(Date.now() - 60_000);
    const task = await prisma.scheduledTask.create({
      data: { name: `${prefix}-plain`, scheduleType: "ONCE", runAt: due, cronExpression: "", command: "uptime", serverIds: ["srv"], createdById: prefix, approvalRequired: true, status: "ACTIVE", nextRunAt: due },
    });
    createCommandRequest.mockImplementationOnce(createRequest);

    await dispatchDueScheduledTasks("plain");

    const after = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(after).toMatchObject({ status: "DISABLED", nextRunAt: null, claimedOccurrenceAt: null, runCount: 1 });
  });
});
