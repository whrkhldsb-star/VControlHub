// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Crash window between the scheduled-task claim and the dispatch record, on a
 * real PostgreSQL. The first worker claims the occurrence, creates the command
 * and then never finishes (process killed). Once the claim lease expires the
 * next tick must pick the same occurrence up again with the same idempotency
 * key — not skip the task for a day under a far-future sentinel.
 */
const { createCommandRequest, recordTaskDispatch } = vi.hoisted(() => ({
  createCommandRequest: vi.fn(),
  recordTaskDispatch: vi.fn(),
}));

vi.mock("@/lib/command/service", () => ({ createCommandRequest }));
vi.mock("@/lib/auth/command-execution-authz", () => ({
  assertRequesterMayExecuteCommand: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../service")>()),
  recordTaskDispatch,
}));

import { prisma } from "@/lib/db";
import { dispatchDueScheduledTasks } from "../worker";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("scheduled-task claim survives a worker crash", () => {
  const prefix = `sched-crash-${randomUUID()}`;

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "not-a-login-hash" } });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  afterAll(async () => {
    await prisma.scheduledTask.deleteMany({ where: { createdById: prefix } });
    await prisma.user.delete({ where: { id: prefix } });
    await prisma.$disconnect();
  });

  it("re-dispatches the same occurrence after the claim lease expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = new Date();
    vi.setSystemTime(t0);
    const occurrence = new Date(t0.getTime() - 60_000);
    const task = await prisma.scheduledTask.create({
      data: {
        name: prefix,
        cronExpression: "0 * * * *",
        command: "uptime",
        serverIds: ["srv-crash"],
        createdById: prefix,
        approvalRequired: true,
        status: "ACTIVE",
        nextRunAt: occurrence,
      },
    });
    const keys: string[] = [];
    createCommandRequest.mockImplementation(async (input: { idempotencyKey: string }) => {
      keys.push(input.idempotencyKey);
      return { id: `request-${keys.length}` };
    });
    // First worker: claim + command creation succeed, then the process "dies"
    // before the dispatch is recorded.
    recordTaskDispatch.mockImplementationOnce(() => new Promise(() => undefined));
    void dispatchDueScheduledTasks("crash");
    await vi.waitFor(() => expect(keys).toHaveLength(1));

    const claimed = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(claimed.nextRunAt!.getTime() - t0.getTime()).toBeLessThanOrEqual(15 * 60_000);

    // Before the lease expires nobody touches it.
    vi.setSystemTime(new Date(t0.getTime() + 2 * 60_000));
    await dispatchDueScheduledTasks("too-early");
    expect(keys).toHaveLength(1);

    // After it expires the next tick dispatches the SAME occurrence.
    recordTaskDispatch.mockResolvedValue(undefined);
    vi.setSystemTime(new Date(t0.getTime() + 11 * 60_000));
    await dispatchDueScheduledTasks("recover");
    expect(keys).toEqual([
      `scheduled-task:${task.id}:${occurrence.toISOString()}`,
      `scheduled-task:${task.id}:${occurrence.toISOString()}`,
    ]);
    expect(recordTaskDispatch).toHaveBeenLastCalledWith(task.id, "request-2");
  });

  it("a dispatch that cannot be linked is retried, not recorded as a failed run", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = new Date();
    vi.setSystemTime(t0);
    const occurrence = new Date(t0.getTime() - 60_000);
    const task = await prisma.scheduledTask.create({
      data: {
        name: `${prefix}-once`,
        cronExpression: "0 * * * *",
        scheduleType: "ONCE",
        command: "uptime",
        serverIds: ["srv-link"],
        createdById: prefix,
        approvalRequired: true,
        status: "ACTIVE",
        nextRunAt: occurrence,
      },
    });
    createCommandRequest.mockReset();
    recordTaskDispatch.mockReset();
    createCommandRequest.mockResolvedValue({ id: "request-linked" });
    // The request exists; writing its link fails once.
    recordTaskDispatch.mockRejectedValueOnce(new Error("connection reset"));
    await dispatchDueScheduledTasks("link-fails");

    // A ONCE task used to be disabled here with "Execution failed", and the
    // pending approval it created lost its result for good.
    const afterFailure = await prisma.scheduledTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(afterFailure.status).toBe("ACTIVE");
    expect(afterFailure.nextRunAt?.toISOString()).toBe(occurrence.toISOString());
    expect(afterFailure.lastResult ?? "").not.toMatch(/failed/i);

    // The next tick replays the occurrence: same idempotency key, same request, now linked.
    recordTaskDispatch.mockResolvedValue(undefined);
    await dispatchDueScheduledTasks("retry");
    expect(createCommandRequest).toHaveBeenLastCalledWith(expect.objectContaining({ idempotencyKey: `scheduled-task:${task.id}:${occurrence.toISOString()}` }));
    expect(recordTaskDispatch).toHaveBeenLastCalledWith(task.id, "request-linked");
  });
});

