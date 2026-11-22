// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * A schedule edited while its occurrence is being dispatched keeps the edit.
 * The dispatch record used to overwrite it: a ONCE task moved to next hour
 * between "command created" and "dispatch recorded" ended up DISABLED with
 * no next run, so the run the user had just scheduled never happened.
 */
const { authorize, createCommandRequest } = vi.hoisted(() => ({
  authorize: vi.fn(async () => ({ ok: true })), createCommandRequest: vi.fn(),
}));
vi.mock("@/lib/command/service", () => ({ createCommandRequest }));
vi.mock("@/lib/auth/command-execution-authz", () => ({
  assertRequesterMayExecuteCommand: authorize,
}));

import { BusinessError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { oneFileAtATime } from "@/test/helpers/one-file-at-a-time";
import { dispatchDueScheduledTasks } from "../worker";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("scheduled-task edit during dispatch (PostgreSQL)", () => {
  // Another file's dispatch would run this file's due task before the edit it checks.
  oneFileAtATime("scheduled-tasks");
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

  it.each([false, true])("keeps a rescheduled ONCE task when its previous dispatch failed=%s", async (failed) => {
    const due = new Date(Date.now() - 60_000);
    const later = new Date(Date.now() + 3_600_000);
    const task = await prisma.scheduledTask.create({
      data: { name: `${prefix}-once`, scheduleType: "ONCE", runAt: due, cronExpression: "", command: "uptime", serverIds: ["srv"], createdById: prefix, approvalRequired: true, status: "ACTIVE", nextRunAt: due },
    });
    createCommandRequest.mockImplementationOnce(async () => {
      // What updateScheduledTask writes when the run time is changed.
      await prisma.scheduledTask.update({ where: { id: task.id }, data: { runAt: later, nextRunAt: later, claimedOccurrenceAt: null, status: "ACTIVE" } });
      if (failed) throw new BusinessError("disabled target");
      return createRequest();
    });

    await dispatchDueScheduledTasks("edit-race");

    const after = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.status).toBe("ACTIVE");
    expect(after.nextRunAt?.toISOString()).toBe(later.toISOString());
    expect(after.runCount).toBe(failed ? 0 : 1);
  });

  it("reauthorizes the latest definition after the pending claim loses its version", async () => {
    const due = new Date(Date.now() - 60_000);
    const task = await prisma.scheduledTask.create({
      data: { name: prefix, scheduleType: "ONCE", runAt: due, nextRunAt: due, cronExpression: "",
        command: "uptime", serverIds: ["srv"], createdById: prefix, approvalRequired: true },
    });
    authorize.mockImplementationOnce(async () => {
      await prisma.scheduledTask.update({ where: { id: task.id }, data: { command: "pwd", approvalRequired: false } });
      return { ok: true };
    });
    createCommandRequest.mockClear();
    await dispatchDueScheduledTasks("stale");
    expect(createCommandRequest).not.toHaveBeenCalled();
    createCommandRequest.mockImplementationOnce(createRequest);
    await dispatchDueScheduledTasks("fresh");
    expect(createCommandRequest).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ command: "pwd", approvalRequired: false }), undefined, undefined, expect.any(Function));
  });

  it("recovers the original request after a claimed occurrence was edited", async () => {
    const occurrence = new Date(Date.now() - 3600_000);
    const task = await prisma.scheduledTask.create({ data: {
      name: prefix, scheduleType: "ONCE", runAt: occurrence, nextRunAt: new Date(Date.now() - 60_000),
      claimedOccurrenceAt: occurrence, cronExpression: "", command: "pwd", serverIds: ["edited"], createdById: prefix,
    } });
    const row = await createRequest();
    await prisma.commandRequest.update({ where: { id: row.id }, data: { idempotencyKey: `scheduled-task:${task.id}:${occurrence.toISOString()}` } });
    createCommandRequest.mockClear();
    await dispatchDueScheduledTasks("recover-before-authorization");
    expect(createCommandRequest).not.toHaveBeenCalled();
    expect(await prisma.scheduledTaskRun.findUnique({ where: { commandRequestId: row.id } })).toMatchObject({ scheduledTaskId: task.id });
  });

  it("lets a successor advance an occurrence already recorded by the previous worker", async () => {
    const occurrence = new Date(Date.now() - 3600_000);
    const request = await createRequest();
    const task = await prisma.scheduledTask.create({
      data: { name: prefix, scheduleType: "ONCE", runAt: occurrence, nextRunAt: new Date(Date.now() - 60_000),
        claimedOccurrenceAt: occurrence, cronExpression: "", command: "uptime", serverIds: ["srv"],
        createdById: prefix, runCount: 1, runs: { create: { commandRequestId: request.id, dispatchedAt: occurrence } } },
    });
    createCommandRequest.mockResolvedValueOnce(request);
    await dispatchDueScheduledTasks("takeover");
    expect(await prisma.scheduledTask.findUniqueOrThrow({ where: { id: task.id } }))
      .toMatchObject({ status: "DISABLED", nextRunAt: null, claimedOccurrenceAt: null, runCount: 1 });
    expect(await prisma.scheduledTaskRun.count({ where: { scheduledTaskId: task.id } })).toBe(1);
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
