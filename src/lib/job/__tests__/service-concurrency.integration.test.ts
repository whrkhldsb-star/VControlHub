// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { claimNextJob, completeJob, heartbeatJob, recoverStaleRunningJobs } from "../service";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("durable queue PostgreSQL contention", () => {
  const prefix = `queue-audit-${randomUUID()}`;
  let fixturesCreated = false;
  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("Queue tests require an isolated loopback audit/test database");
    }
    await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "not-a-login-hash" } });
    await prisma.storageNode.create({ data: { id: prefix, name: prefix, driver: "LOCAL", basePath: "/nonexistent-queue-fixture" } });
    fixturesCreated = true;
  });
  beforeEach(async () => {
    vi.stubEnv("JOB_PRIORITY_AGING_SECONDS", "60");
    vi.stubEnv("JOB_MAX_CONCURRENT_GLOBAL", "0");
    vi.stubEnv("JOB_MAX_CONCURRENT_PER_USER", "0");
    vi.stubEnv("JOB_MAX_CONCURRENT_PER_NODE", "0");
    await prisma.job.createMany({ data: Array.from({ length: 40 }, (_,index) => ({
      id: `${prefix}-${index}`, type: prefix, title: `${prefix}-${index}`, payload: {}, maxAttempts: 3, createdBy: prefix, targetStorageNodeId: prefix,
    })) });
  });
  afterEach(async () => {
    await prisma.job.deleteMany({ where: { type: prefix } });
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    if (fixturesCreated) {
      await prisma.storageNode.delete({ where: { id: prefix } });
      await prisma.user.delete({ where: { id: prefix } });
    }
    await prisma.$disconnect();
  });
  const claim = (workerId: string) => claimNextJob({ workerId, types: [prefix] });

  it.each(["PER_USER", "PER_NODE"])("claims eligible work beyond a saturated %s backlog", async (scope) => {
    vi.stubEnv(`JOB_MAX_CONCURRENT_${scope}`, "1");
    const busy = (await claim("busy-owner"))!;
    expect(busy).not.toBeNull();
    const free = await prisma.job.create({ data: { type: prefix, title: "eligible tail", payload: {}, priority: -1 } });
    const next = await claim("available-worker");
    expect(next?.id).toBe(free.id);
  });

  it("ages waiting low-priority work ahead of fresh high-priority jobs", async () => {
    const now = new Date();
    await prisma.job.updateMany({ where: { type: prefix }, data: { priority: 10, availableAt: now } });
    const waiting = await prisma.job.create({ data: { type: prefix, title: "old low priority", payload: {}, priority: 0,
      availableAt: new Date(now.getTime() - 11 * 60_000) } });
    expect((await claimNextJob({ workerId: "aging-worker", types: [prefix], now }))?.id).toBe(waiting.id);
  });

  it("prefers an idle owner when eligible jobs have equal effective priority", async () => {
    const now = new Date();
    await prisma.job.updateMany({ where: { type: prefix }, data: { availableAt: now } });
    await claim("busy-owner");
    const idle = await prisma.job.create({ data: { type: prefix, title: "idle owner", payload: {}, availableAt: now } });
    expect((await claimNextJob({ workerId: "fair-worker", types: [prefix], now }))?.id).toBe(idle.id);
  });

  it.each(["GLOBAL", "PER_USER", "PER_NODE"])("enforces the %s cap across simultaneous executors", async (scope) => {
    const existing = scope === "GLOBAL" ? await prisma.job.count({ where: { status: "RUNNING" } }) : 0;
    vi.stubEnv(`JOB_MAX_CONCURRENT_${scope}`, String(existing + 1));
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) => claim(`${prefix}-worker-${index}`)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await prisma.job.count({ where: { type: prefix, status: "RUNNING" } })).toBe(1);
  });

  it("reclaims an expired lease even when its former owner occupied the concurrency slot", async () => {
    vi.stubEnv("JOB_MAX_CONCURRENT_PER_USER", "1");
    vi.stubEnv("JOB_MAX_CONCURRENT_PER_NODE", "1");
    const first = (await claim("crashed-worker"))!;
    expect(first).not.toBeNull();
    await prisma.job.update({ where: { id: first.id }, data: { leaseExpiresAt: new Date(0), priority: 1 } });
    const reclaimed = await claim("replacement-worker");
    expect(reclaimed).toMatchObject({ id: first.id, attempts: 2, workerId: "replacement-worker" });
    expect(await heartbeatJob(first.id, "crashed-worker")).toEqual({ count: 0 });
    expect(await completeJob(first.id, "crashed-worker")).toEqual({ count: 0 });
    expect(await completeJob(first.id, "replacement-worker")).toEqual({ count: 1 });
    expect(await completeJob(first.id, "replacement-worker")).toEqual({ count: 0 });
  });

  it("recovers an interrupted job once and fences late completion from its old worker", async () => {
    const first = (await claim("crashed-worker"))!;
    await prisma.job.update({ where: { id: first.id }, data: { leaseExpiresAt: new Date(0) } });
    const options = { staleBefore: new Date("2001-01-01"), now: new Date("2001-01-01") };
    const recovered = await recoverStaleRunningJobs(options);
    expect(recovered.recovered).toContain(first.id);
    expect((await recoverStaleRunningJobs(options)).recovered).not.toContain(first.id);
    expect(await completeJob(first.id, "crashed-worker")).toEqual({ count: 0 });
    const replacement = await claim("replacement-worker");
    expect(replacement?.id).toBe(first.id);
    expect(await completeJob(first.id, "replacement-worker")).toEqual({ count: 1 });
  });
});
