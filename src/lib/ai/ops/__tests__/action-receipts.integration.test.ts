// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";
import { LeaseLostError } from "@/lib/job/heartbeat-runner";
import { executeScanAction } from "../action-executor";
import { planJobCleanup, pruneAiOpsLogs } from "../retention";
import { approveRecommendation, executeRecommendation, findCompletedScanForJob, getAiOpsLog, listAiOpsLogs, SCAN_LEASE_LOST } from "../service";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("AI Ops durable actions (PostgreSQL)", () => {
  const expected = { providerId: "", binding: "" };
  const modeKey = "ai.ops.mode";
  let priorMode: string | undefined;
  const prefix = "ops-" + randomUUID();
  const alert = (id: string) => ({ id: prefix + id, action: "alert.evaluate", risk: "low" as const });
  const alertIds = ["-a", "-b", "-scan", "-forced", "-downgrade", "-approved", "-unknown"].map((suffix) => prefix + suffix);
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
    priorMode = (await prisma.setting.findUnique({ where: { key: modeKey } }))?.value;
    await prisma.setting.upsert({ where: { key: modeKey }, create: { key: modeKey, value: "autonomous" }, update: { value: "autonomous" } });
    await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "fixture" } });
  });
  afterAll(async () => {
    if (priorMode === undefined) await prisma.setting.deleteMany({ where: { key: modeKey } });
    else await prisma.setting.update({ where: { key: modeKey }, data: { value: priorMode } });
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

  it.each(["mode", "binding"])("rechecks the %s change committed while dispatch waits for the job lock", async (change) => {
    const job = await runningScan(prefix + "-waiting-" + change);
    const action = alert("-downgrade");
    const key = change === "mode" ? modeKey : "ai.ops.providerBinding";
    const previous = (await prisma.setting.findUnique({ where: { key } }))?.value;
    let dispatch: ReturnType<typeof executeScanAction> | undefined;
    try {
      await prisma.$transaction(async (tx) => {
        const [owner] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid FROM jobs WHERE id = ${job.id} FOR UPDATE`;
        dispatch = executeScanAction(job.id, "first", 1, action, new AbortController().signal, expected);
        await vi.waitFor(async () => {
          const [waiter] = await tx.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (SELECT FROM pg_stat_activity WHERE ${owner!.pid}::integer = ANY(pg_blocking_pids(pid))) AS waiting`;
          expect(waiter?.waiting).toBe(true);
        });
        const value = change === "mode" ? "recommendation" : "a different binding";
        await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
      });
      expect(await dispatch).toMatchObject({ executed: false });
      expect(await alertJobs(action.id)).toBe(0);
      expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).payload).toEqual({ reason: "manual" });
    } finally {
      if (previous === undefined) await prisma.setting.deleteMany({ where: { key } });
      else await prisma.setting.update({ where: { key }, data: { value: previous } });
    }
  });

  it("rejects approval after forced execution and preserves the original receipt", async () => {
    const logId = prefix + "-forced";
    const action = { ...alert("-forced"), requiresApproval: true };
    await prisma.aiOpsLog.create({ data: { id: logId, mode: "recommendation", triggerType: "manual", status: "warning", actions: [action] } });
    expect(await executeRecommendation({ logId, actionId: action.id, forceAutonomous: true })).toMatchObject({ executed: true });
    const before = (await getAiOpsLog(logId))!.actions;
    expect(before[0]?.leaseId).toBeTruthy();
    expect(await approveRecommendation({ logId, actionId: action.id, approvedBy: prefix })).toMatchObject({ ok: false });
    expect((await getAiOpsLog(logId))!.actions).toEqual(before);
  });

  it("skips old and new lease-loss diagnostics on takeover and closes orphaned running logs", async () => {
    const jobId = prefix + "-diagnostic";
    const fields = { jobId, triggerType: "scheduled", mode: "autonomous" };
    await prisma.aiOpsLog.createMany({ data: [
      { ...fields, id: jobId + "-old", status: "warning", completedAt: new Date(), errorMessage: SCAN_LEASE_LOST },
      { ...fields, id: jobId + "-new", status: "skipped", completedAt: new Date(), errorMessage: SCAN_LEASE_LOST },
      { ...fields, id: jobId + "-orphan", status: "running" },
    ] });
    expect(await findCompletedScanForJob(jobId)).toBeNull();
    await pruneAiOpsLogs();
    expect(await prisma.aiOpsLog.findUnique({ where: { id: jobId + "-orphan" } })).toMatchObject({ status: "skipped", completedAt: expect.any(Date) });
    await prisma.aiOpsLog.create({ data: { ...fields, id: jobId + "-valid", status: "warning", completedAt: new Date() } });
    expect((await findCompletedScanForJob(jobId))?.id).toBe(jobId + "-valid");
  });

  it("counts old jobs against recent completions of the same type", async () => {
    const type = prefix + "-mixed";
    const cutoff = new Date(Date.now() - 7 * 86400_000);
    const jobs = Array.from({ length: 350 }, (_, i) => ({
      id: type + "-" + i, type, status: "COMPLETED" as const, payload: {}, title: prefix,
      updatedAt: i < 150 ? new Date(cutoff.getTime() - 1000 + i) : new Date(),
    }));
    await prisma.job.createMany({ data: jobs });
    try {
      const plan = await planJobCleanup(cutoff);
      expect(plan.ids.filter((id) => id.startsWith(type))).toEqual(jobs.slice(0, 150).map((job) => job.id));
    } finally {
      await prisma.job.deleteMany({ where: { type } });
    }
  });

  it("reuses the committed receipt after another worker claims the job", async () => {
    const job = await runningScan(prefix + "-lease");
    const action = alert("-scan");
    const signal = new AbortController().signal;
    await expect(executeScanAction(job.id, "first", 0, action, signal, expected)).rejects.toBeInstanceOf(LeaseLostError);
    const completed = await executeScanAction(job.id, "first", 1, action, signal, expected);
    await prisma.job.update({ where: { id: job.id }, data: { workerId: "replacement", attempts: 2 } });
    await expect(executeScanAction(job.id, "first", 1, action, signal, expected)).rejects.toBeInstanceOf(LeaseLostError);
    expect(await executeScanAction(job.id, "replacement", 2, action, signal, expected)).toEqual(completed);
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
    const result = await executeScanAction(job.id, "first", 1, action, new AbortController().signal, expected);
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
