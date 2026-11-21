// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";
import { LeaseLostError } from "@/lib/job/heartbeat-runner";
import { executeScanAction } from "../action-executor";
import { planJobCleanup } from "../retention";
import { approveRecommendation, executeRecommendation, getAiOpsLog, listAiOpsLogs } from "../service";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("AI Ops durable actions (PostgreSQL)", () => {
  const prefix = "ops-" + randomUUID();
  const alert = (id: string) => ({ id: prefix + id, action: "alert.evaluate", risk: "low" as const });
  const alertIds = ["-a", "-b", "-scan", "-approved", "-unknown"].map((suffix) => prefix + suffix);
  const alertJobs = (actionId: string) => prisma.job.count({ where: { type: "alert.evaluate", payload: { path: ["actionId"], equals: actionId } } });
  const runningScan = (id: string) => prisma.job.create({ data: {
    id, type: "ai.ops.scan", title: prefix, payload: { reason: "manual" }, workerId: "first",
    status: "RUNNING", attempts: 1, leaseExpiresAt: new Date(Date.now() + 60_000),
  } });
  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "fixture" } });
  });
  afterAll(async () => {
    await prisma.job.deleteMany({ where: { OR: [
      { id: { startsWith: prefix } }, ...alertIds.map((id) => ({ type: "alert.evaluate", payload: { path: ["actionId"], equals: id } })),
    ] } });
    await prisma.aiOpsLog.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.auditLog.deleteMany({ where: { actorId: prefix } });
    await prisma.user.deleteMany({ where: { id: prefix } });
  });

  it("records one dispatch per action when three claimants share one clock tick", async () => {
    const actions = [alert("-a"), alert("-b")].map((a) => ({ ...a, requiresApproval: false }));
    const logId = prefix + "-claims";
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await prisma.aiOpsLog.create({ data: { id: logId, mode: "recommendation", triggerType: "manual", status: "warning", actions, updatedAt: new Date() } });
      const results = await Promise.all([actions[0]!, actions[1]!, actions[0]!].map(({ id }) => executeRecommendation({ logId, actionId: id })));
      expect(results.filter((r) => r.executed)).toHaveLength(2);
      const saved = (await getAiOpsLog(logId))!;
      expect(saved.actions.every((a) => a.executed && a.leaseId)).toBe(true);
      expect(new Set(saved.actions.map((a) => a.leaseId)).size).toBe(2);
      expect(Date.parse(saved.updatedAt)).toBeGreaterThan(Date.now());
      for (const action of actions) expect(await alertJobs(action.id)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reuses the committed receipt after another worker claims the job", async () => {
    const job = await runningScan(prefix + "-lease");
    const action = alert("-scan");
    const signal = new AbortController().signal;
    await expect(executeScanAction(job.id, "first", 0, action, signal)).rejects.toBeInstanceOf(LeaseLostError);
    const completed = await executeScanAction(job.id, "first", 1, action, signal);
    await prisma.job.update({ where: { id: job.id }, data: { workerId: "replacement", attempts: 2 } });
    await expect(executeScanAction(job.id, "first", 1, action, signal)).rejects.toBeInstanceOf(LeaseLostError);
    expect(await executeScanAction(job.id, "replacement", 2, action, signal)).toEqual(completed);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).payload).toMatchObject({ reason: "manual", actionReceipts: [completed] });
    expect(await alertJobs(action.id)).toBe(1);
  });

  it("prunes only reviewed week-old excess, preserving both sample histories and a changed retention boundary", async () => {
    const cutoff = new Date(Date.now() - 7 * 86400_000);
    const type = prefix + "-bulk";
    const row = (type: string, i: number, updatedAt: Date) => ({
      id: prefix + "-" + type + "-" + i, type, updatedAt, status: "COMPLETED" as const, title: prefix, payload: {},
    });
    const old = Array.from({ length: 306 }, (_, i) => row(type, i, new Date(cutoff.getTime() - 1000 + i)));
    const samples = ["health.sample", "traffic.sample"].flatMap((type) => Array.from({ length: 50 }, (_, i) => row(type, i, new Date())));
    await prisma.job.createMany({ data: [...old, ...samples] });
    const plan = await planJobCleanup(cutoff);
    const ids = plan.ids.filter((id) => id.startsWith(prefix));
    expect(ids).toEqual(old.slice(0, 106).map((r) => r.id));
    // Extra history arrived after review and another worker deleted two retained rows.
    const added = row(type, 307, new Date(cutoff.getTime() - 2000));
    await prisma.job.create({ data: added });
    await prisma.job.deleteMany({ where: { id: { in: old.slice(-2).map((r) => r.id) } } });
    const job = await runningScan(prefix + "-cleanup");
    const action = { id: prefix + "-purge", action: "cache.purge:stale", risk: "low" as const, cleanup: { ids, cutoff: cutoff.toISOString() } };
    const result = await executeScanAction(job.id, "first", 1, action, new AbortController().signal);
    expect(result.result).toBe("Pruned 104 stale completed jobs");
    expect(await prisma.job.count({ where: { id: { in: samples.map((r) => r.id) } } })).toBe(100);
    expect(await prisma.job.findUnique({ where: { id: added.id } })).not.toBeNull();
    expect(await prisma.job.count({ where: { type } })).toBe(201);
  });

  it("stores the approving actor and time and restores only successful, matching legacy audit evidence", async () => {
    const logId = prefix + "-approval";
    const when = new Date("2026-01-01T01:00:00Z");
    const old = { executed: false, executedAt: when.toISOString(), result: "in_progress" };
    const actions = [
      { ...alert("-new"), requiresApproval: true },
      { ...alert("-approved"), ...old },
      { ...alert("-unknown"), ...old },
    ];
    await prisma.aiOpsLog.create({ data: { id: logId, triggerType: "manual", mode: "recommendation", status: "warning", actions } });
    const approve = await approveRecommendation({ logId, actionId: actions[0]!.id, approvedBy: prefix });
    expect(approve.ok).toBe(true);
    await prisma.auditLog.createMany({ data: [
      { logId, actionId: actions[1]!.id, ok: true }, { logId, actionId: actions[2]!.id, ok: false },
      { logId: "other", actionId: actions[2]!.id, ok: true },
    ].map((detail) => ({ action: "ai.ops.recommendation.approve", actorId: prefix, actorType: "USER" as const, detail, createdAt: when })) });
    const saved = (await getAiOpsLog(logId))!;
    expect(saved.actions[0]).toMatchObject({ approved: true, approvedBy: prefix, approvedAt: expect.any(String) });
    expect(saved.actions[1]).toMatchObject({ approved: true, approvedBy: prefix, approvedAt: when.toISOString(), approvalNeedsReview: false });
    expect(saved.actions[2]).toMatchObject({ approvalNeedsReview: true, reason: expect.any(String) });
    expect((await listAiOpsLogs()).find((log) => log.id === logId)?.actions).toEqual(saved.actions);
    for (const action of actions.slice(1)) {
      expect((await executeRecommendation({ logId, actionId: action.id, forceAutonomous: true })).executed).toBe(false);
      expect(await alertJobs(action.id)).toBe(0);
    }
    expect((await getAiOpsLog(logId))!.actions.slice(1).map((a) => a.result)).toEqual(["needs_manual_review", "needs_manual_review"]);
  });
});
