// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({ model: "" }));
vi.mock("@/lib/db", async original => {
  const db = await original<typeof import("@/lib/db")>();
  return { ...db, prisma: db.prisma.$extends({ query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (model === fault.model && (operation === "create" || operation === "updateMany")) {
          throw new Error("injected write failure");
        }
        return query(args);
      },
    },
  } }) };
});
vi.mock("@/lib/notification/service", () => ({
  notifyCommandPending: vi.fn(async () => {}), notifyCommandResult: vi.fn(async () => {}), notifyCommandRequest: vi.fn(async () => {}),
}));
import { prisma } from "@/lib/db";
import { enqueueApprovedCommandExecution, markCommandExecutionFailed } from "../service-execution";
import { cancelCommandRequest, listCommandRequestPage, reviewCommandRequest } from "../service-requests";
import { retryScheduledTask, updateScheduledTask } from "@/lib/scheduled-task/service";
import { createTemplate, updateTemplate } from "@/lib/command-template/service";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("command and schedule transaction boundaries", () => {
  const id = "dispatch-" + randomUUID();
  const session = { userId: id, currentTeamId: id, roles: ["admin" as const] };
  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) throw new Error("requires isolated test database");
    await prisma.team.create({ data: { id, slug: id, name: id } });
    await prisma.user.create({ data: { id, username: id, passwordHash: "unused" } });
    await prisma.server.create({ data: { id, teamId: id, host: "fixture.invalid", name: id, username: "fixture", onboardingStatus: "READY", tags: [] } });
  });
  afterAll(async () => {
    fault.model = "";
    await prisma.job.deleteMany({ where: { createdBy: id } });
    await prisma.scheduledTask.deleteMany({ where: { createdById: id } });
    await prisma.commandRequest.deleteMany({ where: { requesterId: id } });
    await prisma.commandTemplate.deleteMany({ where: { teamId: id } });
    await prisma.server.deleteMany({ where: { id } });
    await prisma.user.deleteMany({ where: { id } });
    await prisma.team.deleteMany({ where: { id } });
    await prisma.$disconnect();
  });
  const request = (status: "APPROVED" | "PENDING_APPROVAL" | "RUNNING") => prisma.commandRequest.create({ data: {
    teamId: id, title: id, command: "uptime", status, requesterId: id, initiatedByType: "USER",
    targets: { create: { serverId: id, status } },
  } });
  it("rolls back the claim, targets and log when queue insertion fails, then gives competing dispatchers one job", async () => {
    const row = await request("APPROVED");
    fault.model = "Job";
    try { await expect(enqueueApprovedCommandExecution(row.id, "queue")).rejects.toThrow("injected"); }
    finally { fault.model = ""; }
    const read = () => prisma.commandRequest.findUniqueOrThrow({ where: { id: row.id }, include: { targets: true, executionLogs: true } });
    expect(await read()).toMatchObject({ status: "APPROVED", targets: [{ status: "APPROVED" }], executionLogs: [] });
    const results = await Promise.all([enqueueApprovedCommandExecution(row.id, "a"), enqueueApprovedCommandExecution(row.id, "b")]);
    expect(results.sort()).toEqual([false, true]);
    expect(await read()).toMatchObject({ status: "RUNNING", targets: [{ status: "RUNNING" }] });
    expect(await prisma.job.count({ where: { payload: { path: ["commandRequestId"], equals: row.id } } })).toBe(1);
  });

  it.each(["PENDING_APPROVAL", "RUNNING"] as const)("rolls back both levels after a target write fails for %s", async status => {
    const row = await request(status);
    fault.model = "CommandTarget";
    try {
      const attempt = status === "RUNNING" ? markCommandExecutionFailed(row.id, new Error("executor stopped"))
        : cancelCommandRequest({ commandRequestId: row.id, actorId: id, session });
      await expect(attempt).rejects.toThrow("injected");
    } finally { fault.model = ""; }
    expect(await prisma.commandRequest.findUnique({ where: { id: row.id }, include: { targets: true } }))
      .toMatchObject({ status, targets: [{ status }], workerHeartbeatAt: null });
  });

  it("ends a legacy active target when withdrawing an approved request", async () => {
    const row = await request("APPROVED");
    await prisma.commandTarget.updateMany({ where: { commandRequestId: row.id }, data: { status: "RUNNING" } });
    await cancelCommandRequest({ commandRequestId: row.id, actorId: id, session });
    expect(await prisma.commandRequest.findUnique({ where: { id: row.id }, include: { targets: true } }))
      .toMatchObject({ status: "CANCELLED", targets: [{ status: "FAILED", outcomeUnknown: true, finishedAt: expect.any(Date) }] });
  });

  it("rolls back the manual run, counter and command together, so retry dispatches exactly once", async () => {
    const task = await prisma.scheduledTask.create({ data: { name: id, command: "uptime", cronExpression: "0 2 * * *",
      serverIds: [id], teamId: id, createdById: id, approvalRequired: false, status: "PAUSED" } });
    const count = () => prisma.commandRequest.count({ where: { title: "Scheduled task retry: " + id } });
    fault.model = "ScheduledTaskRun";
    try { await expect(retryScheduledTask(task.id, session)).rejects.toThrow("injected"); }
    finally { fault.model = ""; }
    expect(await count()).toBe(0);
    expect(await prisma.scheduledTask.findUnique({ where: { id: task.id } })).toMatchObject({ runCount: 0 });
    await retryScheduledTask(task.id, session);
    expect(await count()).toBe(1);
    expect(await prisma.scheduledTaskRun.count({ where: { scheduledTaskId: task.id, manual: true } })).toBe(1);
  });

  it("enforces both identities of a manual run and preserves the administrator exception", async () => {
    const initiator = id + "-initiator";
    await prisma.user.create({ data: { id: initiator, username: initiator, passwordHash: "unused" } });
    try {
      const task = await prisma.scheduledTask.create({ data: { name: id, command: "pwd", cronExpression: "0 2 * * *",
        serverIds: [id], teamId: id, createdById: id, approvalRequired: true, status: "PAUSED" } });
      const member = { currentTeamId: id, roles: ["operator" as const], userId: initiator };
      await retryScheduledTask(task.id, member);
      const run = await prisma.scheduledTaskRun.findFirstOrThrow({ where: { scheduledTaskId: task.id } });
      const review = (userId: string) => reviewCommandRequest({ commandRequestId: run.commandRequestId, approverId: userId, approved: true },
        { ...member, userId });
      await expect(review(id)).rejects.toMatchObject({ name: "BusinessError" });
      await expect(review(initiator)).rejects.toMatchObject({ name: "BusinessError" });
      expect(await prisma.commandApproval.count({ where: { commandRequestId: run.commandRequestId } })).toBe(0);
      await reviewCommandRequest({ commandRequestId: run.commandRequestId, approved: true, approverId: id }, session);
      expect(await prisma.executionLog.count({ where: { commandRequestId: run.commandRequestId, id: { startsWith: "approval-" } } })).toBe(1);
      expect(await prisma.job.findFirstOrThrow({ where: { payload: { path: ["commandRequestId"], equals: run.commandRequestId } } }))
        .toMatchObject({ payload: { planAuthorId: id, runInitiatorId: initiator } });
    } finally { await prisma.user.delete({ where: { id: initiator } }); }
  });

  it("paginates tied pending requests and includes every target without transferring stored output", async () => {
    const prefix = id + "-queue-";
    const ids = Array.from({ length: 503 }, (_, i) => prefix + String(i).padStart(3, "0"));
    await prisma.commandRequest.createMany({ data: ids.map(key => ({
      id: key, teamId: id, title: key, command: "pwd", requesterId: id, initiatedByType: "USER", createdAt: new Date("2035-01-01"),
    })) });
    await prisma.commandTarget.createMany({ data: Array.from({ length: 51 }, () => ({
      commandRequestId: ids.at(-1)!, serverId: id, stdout: "private output", stderr: "private error",
    })) });
    const first = await listCommandRequestPage(session);
    expect(first.pendingCount).toBeGreaterThanOrEqual(503);
    expect(first.nextCursor).toBe(new Date("2035-01-01").getTime() + "." + ids[3]);
    expect(first.requests[0]?.targets).toHaveLength(51);
    expect(JSON.stringify(first.requests[0])).not.toContain("private output");
    await prisma.commandRequest.delete({ where: { id: ids[3] } });
    const next = await listCommandRequestPage(session, first.nextCursor!);
    expect(next.requests.filter(row => row.id.startsWith(prefix)).map(row => row.id)).toEqual(ids.slice(0, 3).reverse());
  });

  it("accepts an equivalent cron-only edit and preserves the claimed occurrence and its version", async () => {
    const due = new Date("2025-04-01T02:00:00Z");
    const row = await prisma.scheduledTask.create({ data: { name: id, command: "uptime", cronExpression: "0 2 * * *",
      serverIds: [id], teamId: id, createdById: id, nextRunAt: due, claimedOccurrenceAt: due } });
    const result = await updateScheduledTask(row.id, { cronExpression: " 0  2 * * * " }, session);
    expect(result).toMatchObject({ nextRunAt: due, claimedOccurrenceAt: due, updatedAt: row.updatedAt });
  });

  it("preserves variables from concurrent edits to both commands and accepts a variables-only patch", async () => {
    const actor = { userId: id };
    const row = await createTemplate({ name: id, command: "uptime", variables: ["explicit"], createdById: id, teamId: id });
    expect(row.variables).toEqual(["explicit"]);
    await Promise.all([
      updateTemplate(row.id, { command: "echo {{forward}}" }, actor, session),
      updateTemplate(row.id, { rollbackCommand: "echo {{rollback}}" }, actor, session),
    ]);
    expect((await prisma.commandTemplate.findUniqueOrThrow({ where: { id: row.id } })).variables).toEqual(["forward", "rollback"]);
    expect((await updateTemplate(row.id, { variables: ["form"] }, actor, session)).variables).toEqual(["form"]);
  });
});
