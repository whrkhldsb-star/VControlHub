// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";

import { listOperationTaskResult } from "../service";

/**
 * An old RUNNING job followed by more completed jobs than the list limit. The
 * status filter and the "attention" sort must still surface it; every status
 * filter must translate into valid queries for every source. Real PostgreSQL.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("operation task filters run before truncation", () => {
  const prefix = `optask-${randomUUID()}`;
  const session = { userId: prefix, roles: ["operator" as const], currentTeamId: prefix };

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    await prisma.team.create({ data: { id: prefix, slug: prefix, name: prefix } });
    await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "not-a-login-hash" } });
    const base = Date.parse("2026-09-01T00:00:00Z");
    await prisma.job.create({
      data: { id: `${prefix}-stuck`, type: "download.execute", title: "stuck download", payload: {}, status: "RUNNING", createdBy: prefix, teamId: prefix, createdAt: new Date(base) },
    });
    await prisma.job.createMany({
      data: Array.from({ length: 30 }, (_, index) => ({
        id: `${prefix}-done-${index}`, type: "backup.create", title: `backup ${index}`, payload: {}, status: "COMPLETED" as const,
        createdBy: prefix, teamId: prefix, createdAt: new Date(base + (index + 1) * 60_000),
      })),
    });
  });

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { createdBy: prefix } });
    await prisma.user.deleteMany({ where: { id: prefix } });
    await prisma.team.deleteMany({ where: { id: prefix } });
    await prisma.$disconnect();
  });

  it("finds the old running task with the status filter even though newer tasks exceed the limit", async () => {
    const recent = await listOperationTaskResult({ limit: 10 }, session);
    expect(recent.tasks.map((task) => task.sourceId)).not.toContain(`${prefix}-stuck`);

    const running = await listOperationTaskResult({ limit: 10, status: "running" }, session);
    expect(running.tasks.map((task) => task.sourceId)).toEqual([`${prefix}-stuck`]);
  });

  it("ranks the old running task first under the attention sort", async () => {
    const attention = await listOperationTaskResult({ limit: 10, sort: "attention" }, session);
    expect(attention.tasks[0]?.sourceId).toBe(`${prefix}-stuck`);
  });

  it("applies the task-type filter in the query", async () => {
    const typed = await listOperationTaskResult({ limit: 10, taskType: "download.execute" }, session);
    expect(typed.tasks.map((task) => task.sourceId)).toEqual([`${prefix}-stuck`]);
  });

  it.each(["pending", "running", "completed", "failed", "cancelled", "paused"] as const)(
    "builds valid queries for every source with status=%s",
    async (status) => {
      await expect(listOperationTaskResult({ limit: 5, status }, session)).resolves.toBeDefined();
      await expect(listOperationTaskResult({ limit: 5, status: [status, "failed"] }, { ...session, roles: ["admin"] })).resolves.toBeDefined();
    },
  );
});
