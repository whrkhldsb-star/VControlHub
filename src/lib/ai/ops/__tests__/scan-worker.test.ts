/**
 * TR-032 E02: AI ops — scan worker unit tests.
 *
 * Verifies the worker orchestration: enqueue → claim → collect signals →
 * write AiOpsLog → complete job. Mirrors the cost-snapshot-worker test
 * pattern.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  jobMocks,
  alertCountMock,
  commandFailureCountMock,
  playbookFailureCountMock,
  serverCountMock,
  backupFailureCountMock,
  aiOpsLogCountMock,
  aiOpsLogDeleteManyMock,
  pruneJobsMock,
  getSettingMock,
  providerFindFirstMock,
  sendChatRequestMock,
  latestSamplesMock,
  cleanupCandidates,
} = vi.hoisted(() => ({
  latestSamplesMock: vi.fn(async (_sql: TemplateStringsArray) => [] as unknown[]),
  cleanupCandidates: vi.fn(async () => [] as Array<{ id: string; excess: bigint }>),
  jobMocks: {
    enqueueJob: vi.fn(),
    claimNextJob: vi.fn(),
    heartbeatJob: vi.fn(),
    completeJob: vi.fn(),
    failJob: vi.fn(),
    findFirst: vi.fn(),
  },
  alertCountMock: vi.fn(),
  commandFailureCountMock: vi.fn(),
  playbookFailureCountMock: vi.fn(),
  serverCountMock: vi.fn(),
  backupFailureCountMock: vi.fn(),
  aiOpsLogCountMock: vi.fn(),
  aiOpsLogDeleteManyMock: vi.fn(),
  pruneJobsMock: vi.fn(),
  getSettingMock: vi.fn(),
  providerFindFirstMock: vi.fn(),
  sendChatRequestMock: vi.fn(),
}));

vi.mock("@/lib/job/service", () => ({
  enqueueJob: jobMocks.enqueueJob,
  claimNextJob: jobMocks.claimNextJob,
  heartbeatJob: jobMocks.heartbeatJob,
  completeJob: jobMocks.completeJob,
  failJob: jobMocks.failJob,
  pruneCompletedJobsByType: pruneJobsMock,
}));

vi.mock("@/lib/concurrency/advisory-lock", () => ({
  acquireAdvisoryLock: vi.fn(async () => vi.fn(async () => undefined)),
}));

vi.mock("@/lib/health/service-alerts", () => ({
  evaluateAlerts: vi.fn(async () => ({ evaluated: true })),
}));

const platformLocale = vi.hoisted(() => ({ value: "zh" as "zh" | "en" }));
vi.mock("@/lib/settings/platform-defaults", () => ({
  getPlatformDefaults: async () => ({ locale: platformLocale.value, theme: "dark" }),
}));

vi.mock("@/lib/settings/service", () => ({
  getSetting: getSettingMock,
}));

vi.mock("@/lib/ai/service-runtime", () => ({
  sendChatRequestToProvider: sendChatRequestMock,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    setting: { findMany: vi.fn(async ({ where }) => Promise.all(where.key.in.map(async (key: string) => ({ key, value: await getSettingMock(key) })))) },
    $transaction: vi.fn(async (run) => run(prisma)),
    job: {
      findFirst: jobMocks.findFirst,
      findMany: vi.fn(async () => []),
      findUniqueOrThrow: vi.fn(async () => ({ payload: {} })),
      update: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => 0),
    },
    systemConfig: {
      findUnique: vi.fn(async () => null),
    },
    aiProvider: {
      findMany: vi.fn(async () => []),
      findFirst: providerFindFirstMock,
    },
    knowledgeDocument: { findMany: vi.fn(async () => []) },
    alertRule: {
      count: alertCountMock,
    },
    commandRequest: {
      count: commandFailureCountMock,
    },
    playbookRun: {
      count: playbookFailureCountMock,
    },
    server: {
      count: serverCountMock,
    },
    metricSnapshot: {
      findMany: vi.fn(async () => []),
    },
    // Each server's latest sample (DISTINCT ON in SQL).
    $queryRaw: (sql: TemplateStringsArray) => {
      if (sql.join("").includes("AS excess FROM")) return cleanupCandidates();
      return sql.join("").includes("FROM jobs") ? [{ id: "job_1" }] : latestSamplesMock(sql);
    },
    backupRecord: {
      count: backupFailureCountMock,
    },
    aiOpsLog: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const id = `log_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        return Promise.resolve({
          id,
          triggerType: data.triggerType,
          mode: data.mode,
          status: data.status,
          findings: data.findings,
          actions: data.actions,
          notes: data.notes ?? null,
          errorMessage: null,
          providerId: data.providerId ?? null,
          startedAt: data.startedAt ?? new Date(),
          completedAt: null,
          durationMs: null,
          triggeredById: data.triggeredById ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }),
      findUnique: vi.fn(async () => ({
        startedAt: new Date(Date.now() - 1000),
      })),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => ({
          id: where.id,
          triggerType: "manual",
          mode: "recommendation",
          status: data.status,
          findings: data.findings,
          actions: data.actions,
          notes: data.notes ?? null,
          errorMessage: data.errorMessage ?? null,
          providerId: null,
          startedAt: new Date(Date.now() - 1000),
          completedAt: data.completedAt ?? new Date(),
          durationMs: 1000,
          triggeredById: null,
          createdAt: new Date(Date.now() - 1000),
          updatedAt: new Date(),
        }),
      ),
      updateMany: vi.fn(async () => ({ count: 1 })),
      count: aiOpsLogCountMock,
      deleteMany: aiOpsLogDeleteManyMock,
    },
  },
}));

import {
  AI_OPS_SCAN_LEASE_MS,
  millisecondsUntilNextLocalHour,
  requestAiOpsScan,
  runAiOpsScanWorkerOnce,
  startAiOpsScanWorker,
  stopAiOpsScanWorkerForTests,
} from "../scan-worker";
import { APP_TIME_ZONE } from "@/lib/datetime/time-zone";
import { prisma } from "@/lib/db";
import { serializeAiOpsProviderBinding, AI_OPS_BINDING_KEY, providerConfigurationVersion, readAiOpsSettings } from "../provider-binding";
const alertJobs = () => jobMocks.enqueueJob.mock.calls.filter(([input]) => input.type === "alert.evaluate");

const boundProvider = {
  id: "provider-1", createdBy: "admin-1", defaultModel: "ops-model",
  type: "OPENAI_COMPATIBLE", baseUrl: "https://provider.example/v1", apiKey: "encrypted-key",
} as const;

function configureProvider(mode: string, defaultModel = "ops-model") {
  const provider = { ...boundProvider, defaultModel };
  providerFindFirstMock.mockResolvedValue(provider);
  getSettingMock.mockImplementation(async (key: string) => {
    if (key === AI_OPS_BINDING_KEY) return serializeAiOpsProviderBinding(provider);
    if (key === "ai.ops.provider") return provider.id;
    return mode;
  });
}

describe("millisecondsUntilNextLocalHour", () => {
  // APP_TIME_ZONE is Asia/Shanghai (UTC+8, no DST) — 02:00 wall clock is
  // 18:00 UTC of the previous day. Build instants in UTC so the expectation
  // holds regardless of the test host's local timezone.
  it("targets the next schedule hour in APP_TIME_ZONE before and after the daily hour", () => {
    // 01:30 Shanghai (17:30 UTC) → 30min until 02:00 Shanghai (18:00 UTC).
    expect(
      millisecondsUntilNextLocalHour(2, new Date("2026-06-16T17:30:00Z")),
    ).toBe(30 * 60 * 1000);
    // 02:30 Shanghai (18:30 UTC) → 23.5h until tomorrow's 02:00 Shanghai.
    expect(
      millisecondsUntilNextLocalHour(2, new Date("2026-06-16T18:30:00Z")),
    ).toBe(23.5 * 60 * 60 * 1000);
  });

  it("is independent of the host's local timezone (uses APP_TIME_ZONE)", () => {
    expect(APP_TIME_ZONE).toBe("Asia/Shanghai");
    // Same instant as above expressed via a different host-local reading:
    // regardless of how the host renders it, the target instant is 18:00 UTC.
    const now = new Date("2026-06-16T17:30:00Z");
    const ms = millisecondsUntilNextLocalHour(2, now);
    expect(new Date(now.getTime() + ms).toISOString()).toBe(
      "2026-06-16T18:00:00.000Z",
    );
  });
});

beforeEach(() => {
  latestSamplesMock.mockReset().mockResolvedValue([]);
  jobMocks.findFirst.mockReset();
  jobMocks.findFirst.mockResolvedValue(null);
  jobMocks.enqueueJob.mockReset();
  jobMocks.enqueueJob.mockResolvedValue({ id: "job_1" });
  jobMocks.claimNextJob.mockReset();
  jobMocks.claimNextJob.mockResolvedValue({
    id: "job_1",
    payload: { reason: "manual", requestedAt: new Date().toISOString() },
  });
  jobMocks.heartbeatJob.mockReset();
  jobMocks.heartbeatJob.mockResolvedValue({ count: 1 });
  jobMocks.completeJob.mockReset();
  jobMocks.completeJob.mockResolvedValue({ count: 1 });
  jobMocks.failJob.mockReset();
  jobMocks.failJob.mockResolvedValue(undefined);
  alertCountMock.mockReset();
  alertCountMock.mockResolvedValue(0);
  commandFailureCountMock.mockReset();
  commandFailureCountMock.mockResolvedValue(0);
  playbookFailureCountMock.mockReset();
  playbackFailureCountMockResolveSafe(playbookFailureCountMock);
  serverCountMock.mockReset();
  serverCountMock.mockResolvedValue(0);
  backupFailureCountMock.mockReset();
  backupFailureCountMock.mockResolvedValue(0);
  aiOpsLogCountMock.mockReset();
  aiOpsLogCountMock.mockResolvedValue(0);
  aiOpsLogDeleteManyMock.mockReset();
  aiOpsLogDeleteManyMock.mockResolvedValue({ count: 0 });
  pruneJobsMock.mockReset();
  pruneJobsMock.mockResolvedValue({ pruned: 0 });
  getSettingMock.mockReset();
  getSettingMock.mockResolvedValue(null);
  providerFindFirstMock.mockReset();
  providerFindFirstMock.mockResolvedValue(null);
  sendChatRequestMock.mockReset();
  vi.mocked(prisma.aiOpsLog.findFirst).mockReset().mockResolvedValue(null);
});

function playbackFailureCountMockResolveSafe(mock: ReturnType<typeof vi.fn>) {
  mock.mockResolvedValue(0);
}

afterEach(() => {
  stopAiOpsScanWorkerForTests();
});

describe("runAiOpsScanWorkerOnce", () => {
  it("writes an AiOpsLog with status=ok when no system-health signals are present", async () => {
    const ok = await runAiOpsScanWorkerOnce("manual");
    expect(ok).toBe(true);
    expect(jobMocks.enqueueJob).toHaveBeenCalledTimes(1);
    expect(jobMocks.claimNextJob).toHaveBeenCalledTimes(1);
    expect(jobMocks.completeJob).toHaveBeenCalledTimes(1);
    expect(jobMocks.failJob).not.toHaveBeenCalled();
  });

  it("surfaces a warning when alert rules exceed the noise threshold", async () => {
    alertCountMock.mockResolvedValue(25);
    const ok = await runAiOpsScanWorkerOnce("manual");
    expect(ok).toBe(true);
    // completeJob is called with the log payload; status should be "warning"
    // We can introspect the result arg.
    const completeArgs = jobMocks.completeJob.mock.calls[0]?.[2] as {
      status?: string;
    };
    expect(completeArgs?.status).toBe("warning");
  });

  it("judges pressure and offline state from every server's latest sample", async () => {
    // 600 servers: the newest 500 samples of the fleet no longer stand in for all of them.
    latestSamplesMock.mockResolvedValue([
      ...Array.from({ length: 598 }, (_, i) => ({ serverId: `s${i}`, cpuUsage: 10, memUsage: 20, diskUsage: 30, isOnline: true })),
      { serverId: "full", cpuUsage: 10, memUsage: 20, diskUsage: 95, isOnline: true },
      { serverId: "down", cpuUsage: 99, memUsage: 99, diskUsage: 99, isOnline: false },
    ]);
    await expect(runAiOpsScanWorkerOnce("manual")).resolves.toBe(true);
    const findings = (vi.mocked(prisma.aiOpsLog.update).mock.calls.at(-1)![0].data as { findings: Array<{ source: string; body: string }> }).findings;
    const disk = findings.find((finding) => finding.source === "metric.disk");
    // One full disk; the offline server's figures are not counted as pressure.
    expect(disk?.body).toMatch(/^1 server/);
    expect(findings.some((finding) => finding.source === "metric.cpu")).toBe(false);
    expect(String((latestSamplesMock.mock.calls[0] as unknown as [TemplateStringsArray])[0].join(""))).toContain('DISTINCT ON (m."serverId")');
    latestSamplesMock.mockResolvedValue([]);
  });

  it("flags completed jobs only beyond what each type keeps on purpose", async () => {
    // Every type keeps its latest runs (up to 200) as its history: counting all
    // week-old completed jobs flagged that on every scan and recommended a purge.
    const findings = async () => {
      await runAiOpsScanWorkerOnce("manual");
      return (vi.mocked(prisma.aiOpsLog.update).mock.calls.at(-1)![0].data as { findings: Array<{ id: string; body: string }> }).findings;
    };
    cleanupCandidates.mockResolvedValueOnce([]);
    expect((await findings()).some((finding) => finding.id === "job.stale-accumulation")).toBe(false);
    cleanupCandidates.mockResolvedValueOnce([{ id: "reviewed", excess: BigInt(250) }]);
    expect((await findings()).find((finding) => finding.id === "job.stale-accumulation")?.body).toMatch(/^250 /);
  });

  it("reports a check it could not read instead of passing it", async () => {
    // Read errors fell back to 0: the scan was saved "ok" with no findings.
    commandFailureCountMock.mockRejectedValueOnce(new Error("statement timeout"));
    await runAiOpsScanWorkerOnce("manual");
    const update = vi.mocked(prisma.aiOpsLog.update).mock.calls.at(-1)![0].data as { status: string; findings: Array<{ id: string; body: string }> };
    expect(update.status).toBe("warning");
    expect(update.findings.find((finding) => finding.id === "scan.incomplete")?.body).toContain("command.execution");
  });

  it("files the daily timer's scan as scheduled", async () => {
    jobMocks.claimNextJob.mockResolvedValueOnce({ id: "job_1", payload: { reason: "scheduled", requestedAt: new Date().toISOString() } });
    await runAiOpsScanWorkerOnce("scheduled");
    expect(vi.mocked(prisma.aiOpsLog.create).mock.calls.at(-1)![0].data).toMatchObject({ triggerType: "scheduled" });
  });

  it("reports the alert-rule count as unread instead of failing the scan when it throws", async () => {
    // alert.rules was the one collector outside the "counted" wrapper (A7): its
    // failure failed the whole job while every other read was reported as unread.
    alertCountMock.mockRejectedValue(new Error("db down"));
    const ok = await runAiOpsScanWorkerOnce("manual");
    expect(ok).toBe(true);
    expect(jobMocks.failJob).not.toHaveBeenCalled();
    const update = vi.mocked(prisma.aiOpsLog.update).mock.calls.at(-1)![0].data as { status: string; findings: Array<{ id: string; body: string }> };
    expect(update.status).toBe("warning");
    expect(update.findings.find((finding) => finding.id === "scan.incomplete")?.body).toContain("alert.rules");
  });

  it("calls failJob when the scan log cannot be written", async () => {
    vi.mocked(prisma.aiOpsLog.create).mockRejectedValueOnce(new Error("db down"));
    const ok = await runAiOpsScanWorkerOnce("manual");
    expect(ok).toBe(true);
    expect(jobMocks.failJob).toHaveBeenCalledTimes(1);
    const failArgs = jobMocks.failJob.mock.calls[0];
    expect(failArgs?.[2]).toMatch(/db down/);
  });

  it("acknowledges a completed scan on retry without repeating autonomous actions or clearing the report", async () => {
    getSettingMock.mockImplementation(async (key: string) => key === "ai.ops.mode" ? "autonomous" : "");
    backupFailureCountMock.mockResolvedValue(1);
    jobMocks.enqueueJob.mockClear();
    jobMocks.claimNextJob.mockResolvedValue({ id: "job_1", payload: { reason: "manual" }, attempts: 2, maxAttempts: 2 });
    jobMocks.completeJob.mockRejectedValueOnce(new Error("ack failed"));
    await runAiOpsScanWorkerOnce();
    expect(jobMocks.failJob).not.toHaveBeenCalled();
    expect(prisma.job.updateMany).toHaveBeenCalledWith({
      where: { id: "job_1", status: "RUNNING", workerId: expect.any(String) },
      data: expect.objectContaining({ status: "PENDING", attempts: { decrement: 1 } }),
    });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.job.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "job_1", status: "RUNNING", attempts: 2, maxAttempts: 2 }),
      data: { maxAttempts: { increment: 1 } },
    });
    const writes = vi.mocked(prisma.aiOpsLog.update).mock;
    const saved = await writes.results.at(-1)!.value;
    expect(saved.findings).toEqual([expect.objectContaining({ id: "backup.failure" })]);
    expect(saved.actions).toEqual([expect.objectContaining({ executed: true })]);
    expect(vi.mocked(prisma.aiOpsLog.create).mock.calls.at(-1)?.[0].data.jobId).toBe("job_1");
    const createCount = vi.mocked(prisma.aiOpsLog.create).mock.calls.length;
    vi.mocked(prisma.aiOpsLog.findFirst).mockResolvedValueOnce({ ...saved, mode: "autonomous" });
    await runAiOpsScanWorkerOnce();
    expect(prisma.aiOpsLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ jobId: "job_1", completedAt: { not: null } }) }));
    expect(alertJobs()).toHaveLength(1);
    expect(prisma.aiOpsLog.create).toHaveBeenCalledTimes(createCount);
    expect(jobMocks.completeJob).toHaveBeenLastCalledWith("job_1", expect.any(String), expect.objectContaining({
      logId: saved.id, findingCount: 1, actionCount: 1, status: "warning",
    }));
  });

  it.each(["owner demoted", "endpoint changed", "owner changed", "legacy binding"])("pauses sharing fleet health when %s", async (change) => {
    configureProvider("autonomous");
    if (change === "owner demoted") providerFindFirstMock.mockResolvedValue(null);
    if (change === "endpoint changed") providerFindFirstMock.mockResolvedValue({ ...boundProvider, baseUrl: "https://different.example/" });
    if (change === "owner changed") providerFindFirstMock.mockResolvedValue({ ...boundProvider, createdBy: "new-owner" });
    if (change === "legacy binding") getSettingMock.mockImplementation(async (key: string) => key === "ai.ops.provider" ? boundProvider.id : key === AI_OPS_BINDING_KEY ? "" : "autonomous");
    backupFailureCountMock.mockResolvedValue(1);
    await runAiOpsScanWorkerOnce();
    expect(providerFindFirstMock).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      enabled: true, creator: { status: "ACTIVE", mustChangePassword: false, roles: { some: { role: { key: "admin" } } } },
    }) }));
    expect(sendChatRequestMock).not.toHaveBeenCalled();
    const report = vi.mocked(prisma.aiOpsLog.update).mock.calls.at(-1)![0].data;
    expect(report.providerHealth).toMatchObject({ state: "unavailable", failureKind: "configuration" });
    expect(report.findings).toContainEqual(expect.objectContaining({ id: "ai.provider-unavailable" }));
    expect(report.actions).toContainEqual(expect.objectContaining({ executed: false }));
  });

  it("holds the enqueue lock until the job insert commits", async () => {
    const { acquireAdvisoryLock } = await import("@/lib/concurrency/advisory-lock");
    const released = vi.fn(async () => undefined);
    vi.mocked(acquireAdvisoryLock).mockResolvedValueOnce(released);
    const committed = Promise.withResolvers<{ id: string }>();
    jobMocks.enqueueJob.mockReturnValueOnce(committed.promise);
    const job = requestAiOpsScan("manual", "observe", "admin", "recommendation");
    await vi.waitFor(() => expect(jobMocks.enqueueJob).toHaveBeenCalledOnce());
    expect(released).not.toHaveBeenCalled();
    expect(jobMocks.enqueueJob.mock.calls[0]![0]).toMatchObject({ createdBy: "admin", payload: { mode: "recommendation" } });
    committed.resolve({ id: "queued" });
    expect(await job).toEqual({ id: "queued" });
    expect(released).toHaveBeenCalledOnce();
  });

  it("withholds dispatch if the settings snapshot cannot be read", async () => {
    configureProvider("autonomous");
    getSettingMock.mockImplementation(async (key: string) => {
      if (key === "ai.ops.provider") throw new Error("setting unavailable");
      return "autonomous";
    });
    backupFailureCountMock.mockResolvedValue(1);
    await runAiOpsScanWorkerOnce("manual");
    expect(jobMocks.failJob).toHaveBeenCalledWith(expect.any(String), expect.any(String), "setting unavailable", expect.anything());
    expect(prisma.aiOpsLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "error", errorMessage: "setting unavailable" }),
    }));
    expect(alertJobs()).toHaveLength(0);
  });

  it("reads the mode, provider and its fleet-data binding in one database snapshot", async () => {
    configureProvider("autonomous");
    expect(await readAiOpsSettings()).toEqual({
      mode: "autonomous", providerId: boundProvider.id, binding: serializeAiOpsProviderBinding(boundProvider),
    });
    expect(prisma.setting.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { key: { in: ["ai.ops.mode", "ai.ops.provider", AI_OPS_BINDING_KEY] } }, select: { key: true, value: true },
    });
  });

  it("records a scan exception in the structured error field", async () => {
    vi.mocked(prisma.aiOpsLog.update).mockRejectedValueOnce(new Error("report write failed"));
    await runAiOpsScanWorkerOnce("manual");
    expect(prisma.aiOpsLog.updateMany).toHaveBeenCalledWith({
      where: { id: expect.any(String), status: "running", completedAt: null },
      data: { status: "error", completedAt: expect.any(Date), errorMessage: "report write failed" },
    });
  });

  it.each(["autonomous", "recommendation"])("keeps a cleanup receipt after its finding disappears under %s", async (mode) => {
    const saved = { id: "job.stale-accumulation.autonomous", action: "cache.purge:stale", risk: "low",
      executed: true, executedAt: new Date().toISOString(), result: "Pruned 110 stale completed jobs" };
    jobMocks.claimNextJob.mockResolvedValueOnce({ id: "retry", payload: { reason: "manual", actionReceipts: [saved] } });
    getSettingMock.mockImplementation(async (key: string) => key === "ai.ops.mode" ? mode : "");
    await runAiOpsScanWorkerOnce();
    expect(vi.mocked(prisma.aiOpsLog.update).mock.calls.at(-1)![0].data.actions).toContainEqual(expect.objectContaining(saved));
    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it.each([
    ["recommendation", "autonomous", "recommendation"], ["autonomous", "recommendation", "recommendation"],
  ])("honors a manual %s request under global %s and records the actor", async (requested, global, effective) => {
    jobMocks.claimNextJob.mockResolvedValueOnce({ id: "manual", createdBy: "operator", payload: { reason: "manual", mode: requested } });
    getSettingMock.mockImplementation(async (key: string) => key === "ai.ops.mode" ? global : "");
    backupFailureCountMock.mockResolvedValue(1);
    await runAiOpsScanWorkerOnce("manual");
    expect(prisma.aiOpsLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ mode: effective, triggeredById: "operator" }) });
    expect(alertJobs()).toHaveLength(0);
  });

  it("bounds successful provider bytes before JSON parsing and withholds actions on overflow", async () => {
    configureProvider("autonomous");
    backupFailureCountMock.mockResolvedValue(1);
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(256 * 1024 + 1)); }, cancel }));
    sendChatRequestMock.mockResolvedValue({ providerType: "OPENAI", response });
    await runAiOpsScanWorkerOnce("manual");
    expect(cancel).toHaveBeenCalledOnce();
    const report = vi.mocked(prisma.aiOpsLog.update).mock.calls.at(-1)![0].data;
    expect(report.providerHealth).toMatchObject({ state: "failed" });
    expect(alertJobs()).toHaveLength(0);
  });

  it("uses the configured provider for analysis and records it on the scan log", async () => {
    configureProvider("recommendation");
    sendChatRequestMock.mockResolvedValue({
      providerType: "OPENAI_COMPATIBLE",
      response: Response.json({ choices: [{ message: { content: "Prioritize the failed backup." } }] }),
    });
    backupFailureCountMock.mockResolvedValue(1);

    await expect(runAiOpsScanWorkerOnce("manual")).resolves.toBe(true);

    expect(sendChatRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "provider-1",
        model: "ops-model",
        stream: false,
      }),
      boundProvider,
      expect.any(AbortSignal),
    );
    const completedLog = jobMocks.completeJob.mock.calls[0]?.[2] as {
      logId?: string;
    };
    expect(completedLog.logId).toBeTruthy();
    expect(prisma.aiOpsLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ providerId: "provider-1" }),
      }),
    );
    expect(jobMocks.failJob).not.toHaveBeenCalled();
  });
  it("tells the provider which checks ran and answers in the platform language", async () => {
    configureProvider("recommendation", "glm-5.3");
    sendChatRequestMock.mockResolvedValue({ providerType: "OPENAI_COMPATIBLE", response: Response.json({ choices: [{ message: { content: "所有检查均通过。" } }] }) });
    await runAiOpsScanWorkerOnce("manual");
    const request = sendChatRequestMock.mock.calls[0]![0] as { messages: Array<{ role: string; content: string }> };
    const payload = JSON.parse(request.messages[1]!.content) as { checks: string[]; signals: unknown[] };
    // A healthy scan sends no signals: the checks say what that silence means.
    expect(payload.signals).toEqual([]);
    expect(payload.checks.length).toBeGreaterThanOrEqual(7);
    expect(payload.checks.some((check) => check.includes("Backups"))).toBe(true);
    expect(request.messages[0]!.content).toContain("An empty `signals` list means every check ran and passed");
    expect(request.messages[0]!.content).toContain("scan.incomplete");
    expect(request.messages[0]!.content).toContain("Simplified Chinese");

    platformLocale.value = "en";
    sendChatRequestMock.mockClear();
    await runAiOpsScanWorkerOnce("manual");
    expect((sendChatRequestMock.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[0]!.content).toContain("Write the answer in English.");
    platformLocale.value = "zh";
  });

  it("gives reasoning models room to answer and reports a budget spent on thinking", async () => {
    configureProvider("recommendation", "glm-5.3");
    sendChatRequestMock.mockResolvedValue({ providerType: "OPENAI_COMPATIBLE", response: Response.json({ choices: [{ finish_reason: "length", message: { content: "" } }] }) });
    await runAiOpsScanWorkerOnce("manual");
    expect(sendChatRequestMock.mock.calls[0]![0].max_tokens).toBeGreaterThanOrEqual(2000);
    let data = vi.mocked(prisma.aiOpsLog.update).mock.calls.at(-1)![0].data;
    expect(data.providerHealth).toMatchObject({ state: "failed" });
    expect(data.findings).toEqual(expect.arrayContaining([expect.objectContaining({ source: "ai.provider" })]));

    sendChatRequestMock.mockResolvedValue({ providerType: "OPENAI_COMPATIBLE", response: Response.json({ choices: [{ finish_reason: "length", message: { content: "Check the backup first" } }] }) });
    await runAiOpsScanWorkerOnce("manual");
    data = vi.mocked(prisma.aiOpsLog.update).mock.calls.at(-1)![0].data;
    expect(data.providerHealth).toMatchObject({ state: "success" });
    expect(data.notes).toContain("Check the backup first\n\n[…]");
  });

  it("preserves deterministic findings and withholds autonomous actions when the provider rejects access", async () => {
    configureProvider("autonomous", "ops-model");
    sendChatRequestMock.mockRejectedValue(new Error("403 insufficient balance secret-upstream-text"));
    backupFailureCountMock.mockResolvedValue(1);
    await expect(runAiOpsScanWorkerOnce("manual")).resolves.toBe(true);
    expect(jobMocks.failJob).not.toHaveBeenCalled();
    expect(jobMocks.completeJob).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ status: "warning" }));
    const update = vi.mocked(prisma.aiOpsLog.update).mock.calls.at(-1)![0].data;
    expect(update.findings).toEqual(expect.arrayContaining([expect.objectContaining({ source: "ai.provider" }), expect.objectContaining({ source: expect.stringContaining("backup") })]));
    expect(JSON.stringify(update)).not.toContain("secret-upstream-text");
    expect(update.actions).toEqual(expect.arrayContaining([expect.objectContaining({ executed: false })]));
  });

  it("preserves deterministic findings when the configured provider is disabled or deleted", async () => {
    getSettingMock.mockImplementation(async (key: string) => key === "ai.ops.provider" ? "missing-provider" : "autonomous");
    backupFailureCountMock.mockResolvedValue(1);
    await runAiOpsScanWorkerOnce("manual");
    expect(sendChatRequestMock).not.toHaveBeenCalled();
    expect(jobMocks.failJob).not.toHaveBeenCalled();
    const data = vi.mocked(prisma.aiOpsLog.update).mock.calls.at(-1)![0].data;
    expect(data.providerHealth).toMatchObject({ state: "unavailable", failureKind: "configuration" });
    expect(data.findings).toEqual(expect.arrayContaining([expect.objectContaining({ source: "ai.provider" }), expect.objectContaining({ source: expect.stringContaining("backup") })]));
    expect(data.actions).toEqual(expect.arrayContaining([expect.objectContaining({ executed: false })]));
  });

  describe("autonomous action dispatch", () => {
    const analysis = () => ({
      providerType: "OPENAI_COMPATIBLE",
      response: Response.json({ choices: [{ message: { content: "Review the failed backup." } }] }),
    });

    beforeEach(() => {
      configureProvider("autonomous", "ops-model");
      backupFailureCountMock.mockResolvedValue(1);
      jobMocks.enqueueJob.mockClear();
    });

    it.each([
      { mode: "recommendation", executions: 0 },
      { mode: "autonomous", executions: 1 },
    ])("uses the persisted $mode mode after provider analysis", async ({ mode, executions }) => {
      const reply = Promise.withResolvers<ReturnType<typeof analysis>>();
      sendChatRequestMock.mockReturnValue(reply.promise);
      const scan = runAiOpsScanWorkerOnce("manual");
      await vi.waitFor(() => expect(sendChatRequestMock).toHaveBeenCalledOnce());
      getSettingMock.mockImplementation(async (key: string) => key === "ai.ops.mode" ? mode : key === "ai.ops.provider" ? boundProvider.id : serializeAiOpsProviderBinding(boundProvider));
      reply.resolve(analysis());
      await scan;

      expect(alertJobs()).toHaveLength(executions);
      const data = vi.mocked(prisma.aiOpsLog.update).mock.calls.at(-1)![0].data;
      expect(data.findings).toEqual([expect.objectContaining({ id: "backup.failure" })]);
      expect(data.notes).toContain("Review the failed backup.");
      expect(data.actions).toEqual([expect.objectContaining({ action: "alert.evaluate", executed: executions === 1 })]);
    });

    it.each(["returns an analysis", "rejects the request"])("keeps diagnostics when the lease expires and the provider %s", async (outcome) => {
      vi.useFakeTimers();
      jobMocks.heartbeatJob.mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 });
      const reply = Promise.withResolvers<ReturnType<typeof analysis>>();
      sendChatRequestMock.mockReturnValue(reply.promise);
      const scan = runAiOpsScanWorkerOnce("manual");
      await vi.advanceTimersByTimeAsync(0);
      const signal = sendChatRequestMock.mock.calls[0]![2] as AbortSignal;
      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(AI_OPS_SCAN_LEASE_MS);
      expect(signal.aborted).toBe(true);
      if (outcome === "returns an analysis") reply.resolve(analysis());
      else reply.reject(signal.reason);
      await scan;

      expect(alertJobs()).toHaveLength(0);
      expect(jobMocks.completeJob).not.toHaveBeenCalled();
      expect(jobMocks.failJob).not.toHaveBeenCalled();
      const data = vi.mocked(prisma.aiOpsLog.update).mock.calls.at(-1)![0].data;
      expect(data.findings).toEqual([expect.objectContaining({ id: "backup.failure" })]);
      expect(data.actions).toEqual([expect.objectContaining({ action: "alert.evaluate", executed: false, result: expect.stringContaining("lease") })]);
      if (outcome === "returns an analysis") expect(data.notes).toContain("Review the failed backup.");
      else expect(data.providerHealth).toBeUndefined();
    });

    it("stops before scanning if the first heartbeat already lost the lease", async () => {
      jobMocks.heartbeatJob.mockResolvedValueOnce({ count: 0 });
      await runAiOpsScanWorkerOnce("manual");
      expect(sendChatRequestMock).not.toHaveBeenCalled();
      expect(alertJobs()).toHaveLength(0);
      expect(jobMocks.completeJob).not.toHaveBeenCalled();
      expect(jobMocks.failJob).not.toHaveBeenCalled();
    });

    it("checks the lease again when the dispatch mode read returns autonomous", async () => {
      vi.useFakeTimers();
      jobMocks.heartbeatJob.mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 });
      const mode = Promise.withResolvers<string>();
      const readDispatchMode = vi.fn(() => mode.promise);
      sendChatRequestMock.mockImplementationOnce(async () => {
        getSettingMock.mockImplementation(readDispatchMode);
        return analysis();
      });
      const scan = runAiOpsScanWorkerOnce("manual");
      await vi.advanceTimersByTimeAsync(0);
      expect(readDispatchMode).toHaveBeenCalledWith("ai.ops.mode");
      const signal = sendChatRequestMock.mock.calls[0]![2] as AbortSignal;
      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(AI_OPS_SCAN_LEASE_MS);
      expect(signal.aborted).toBe(true);
      mode.resolve("autonomous");
      await scan;

      expect(alertJobs()).toHaveLength(0);
      const data = vi.mocked(prisma.aiOpsLog.update).mock.calls.at(-1)![0].data;
      expect(data.notes).toContain("Review the failed backup.");
      expect(data.actions).toEqual([expect.objectContaining({ executed: false, result: expect.stringContaining("lease") })]);
    });
  });

  it.each(["fingerprint", "legacy-timestamp"])("honours a %s cooldown after discovery and allows a manual retry", async (format) => {
    configureProvider("recommendation", "ops-model");
    // Each scan checks for a completed job report before looking up provider health.
    const refreshed = { ...boundProvider, updatedAt: new Date(), availableModels: '["discovered"]' };
    providerFindFirstMock.mockResolvedValue(refreshed);
    expect(providerConfigurationVersion(refreshed)).toBe(providerConfigurationVersion(boundProvider));
    expect(providerConfigurationVersion({ ...boundProvider, apiKey: "rotated" })).not.toBe(providerConfigurationVersion(refreshed));
    const history = { providerHealth: {
      state: "failed", configurationVersion: format === "legacy-timestamp" ? "2026-01-01T00:00:00.000Z" : providerConfigurationVersion(boundProvider),
      consecutiveFailures: 2, failureKind: "quota",
      httpStatus: 403, retryAt: new Date(Date.now() + 86_400_000).toISOString(),
    } };
    vi.mocked(prisma.aiOpsLog.findFirst).mockResolvedValueOnce(null).mockResolvedValueOnce(history as never)
      .mockResolvedValueOnce(null).mockResolvedValueOnce(history as never);
    jobMocks.claimNextJob.mockResolvedValueOnce({ id: "scheduled-job", payload: { reason: "interval" } });
    await runAiOpsScanWorkerOnce("interval");
    expect(sendChatRequestMock).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.aiOpsLog.update).mock.calls.at(-1)![0].data.providerHealth).toMatchObject({
      state: "cooldown", consecutiveFailures: 2, configurationVersion: providerConfigurationVersion(refreshed),
    });
    jobMocks.findFirst.mockResolvedValue(null);
    sendChatRequestMock.mockResolvedValue({ providerType: "OPENAI_COMPATIBLE", response: Response.json({ choices: [{ message: { content: "Recovered" } }] }) });
    await runAiOpsScanWorkerOnce("manual");
    expect(sendChatRequestMock).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prisma.aiOpsLog.update).mock.calls.at(-1)![0].data.providerHealth).toMatchObject({ state: "success", consecutiveFailures: 0, retryAt: null });
  });

});

describe("AI ops scan retry wake", () => {
  it("wakes when a failed scan's retry is due, not at the next daily slot", async () => {
    // A failed scan is queued again for an hour later; the worker only woke
    // at the daily hour, so the retry waited for the next day.
    vi.useFakeTimers();
    try {
      const aiOpsLogFindFirst = prisma.aiOpsLog.findFirst as ReturnType<typeof vi.fn>;
      aiOpsLogFindFirst.mockReset();
      aiOpsLogFindFirst.mockImplementation(async (args) => args.where.jobId ? null : { id: "log_recent", completedAt: new Date() }); // no startup scan
      const dueAt = new Date(Date.now() + 60 * 60 * 1000);
      jobMocks.findFirst.mockReset();
      jobMocks.findFirst.mockImplementation(async (args: { select?: { availableAt?: boolean } }) => (args?.select?.availableAt ? { availableAt: dueAt } : { id: "job_retry" }));
      jobMocks.claimNextJob.mockReset();
      jobMocks.claimNextJob.mockResolvedValue(null);

      await startAiOpsScanWorker();
      await vi.advanceTimersByTimeAsync(0);
      expect(jobMocks.claimNextJob).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 1_000);
      expect(jobMocks.claimNextJob).toHaveBeenCalled();
    } finally {
      stopAiOpsScanWorkerForTests();
      vi.useRealTimers();
    }
  });
});

describe("AI ops scan requested from the page", () => {
  it("is picked up within the queue poll, not at the next daily slot", async () => {
    // "Scan now" queues a job from the web process (A7-04). The worker's timer was armed once for the daily
    // hour and looked at the queue only when it was armed, so the scan ran at 02:00 the next day.
    vi.useFakeTimers();
    try {
      const aiOpsLogFindFirst = prisma.aiOpsLog.findFirst as ReturnType<typeof vi.fn>;
      aiOpsLogFindFirst.mockReset();
      aiOpsLogFindFirst.mockImplementation(async (args) => args.where.jobId ? null : { id: "log_recent", completedAt: new Date() }); // no startup scan
      let queuedAt: Date | null = null;
      jobMocks.findFirst.mockReset();
      jobMocks.findFirst.mockImplementation(async (args: { select?: { availableAt?: boolean } }) =>
        queuedAt ? (args?.select?.availableAt ? { availableAt: queuedAt } : { id: "job_manual" }) : null);
      jobMocks.claimNextJob.mockReset();
      jobMocks.claimNextJob.mockImplementation(async () => {
        if (!queuedAt) return null;
        queuedAt = null;
        return { id: "job_manual", payload: { reason: "manual", requestedAt: new Date().toISOString() } };
      });

      await startAiOpsScanWorker();
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      // Nothing queued and not the daily hour: looking at the queue starts no scan.
      expect(jobMocks.enqueueJob).not.toHaveBeenCalled();
      expect(jobMocks.claimNextJob).not.toHaveBeenCalled();

      queuedAt = new Date(); // POST /api/ai/ops/scan
      await vi.advanceTimersByTimeAsync(60_000);
      expect(jobMocks.claimNextJob).toHaveBeenCalledTimes(1);
      expect(jobMocks.completeJob).toHaveBeenCalledWith("job_manual", expect.any(String), expect.objectContaining({ reason: "manual" }));
      // The job that ran is the queued one: the poll adds none of its own.
      expect(jobMocks.enqueueJob).not.toHaveBeenCalled();
    } finally {
      stopAiOpsScanWorkerForTests();
      vi.useRealTimers();
    }
  });
});

describe("startAiOpsScanWorker / stopAiOpsScanWorkerForTests", () => {
  it("startAiOpsScanWorker is idempotent — calling twice doesn't double-start", async () => {
    const a = await startAiOpsScanWorker();
    const b = await startAiOpsScanWorker();
    expect(a.started).toBe(true);
    expect(b.started).toBe(true);
    // Same state reference.
    expect(a).toBe(b);
    stopAiOpsScanWorkerForTests();
  });

  it("skips the startup scan when a scan completed within the guard window", async () => {
    const aiOpsLogFindFirst = prisma.aiOpsLog.findFirst as ReturnType<typeof vi.fn>;
    aiOpsLogFindFirst.mockReset();
    aiOpsLogFindFirst.mockResolvedValueOnce({
      id: "log_recent",
      completedAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    jobMocks.enqueueJob.mockClear();

    await startAiOpsScanWorker();
    // startAiOpsScanWorker fires the guard chain un-awaited; flush microtasks
    // so the assertions observe the settled outcome.
    await new Promise((resolve) => setTimeout(resolve, 0));
    stopAiOpsScanWorkerForTests();

    expect(aiOpsLogFindFirst).toHaveBeenCalledTimes(1);
    expect(aiOpsLogFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["ok", "warning"] },
        }),
        orderBy: { completedAt: "desc" },
      }),
    );
    // No scan job was enqueued for the startup reason.
    expect(jobMocks.enqueueJob).not.toHaveBeenCalled();
  });

  it("runs the startup scan when the last successful scan is older than the guard window", async () => {
    const aiOpsLogFindFirst = prisma.aiOpsLog.findFirst as ReturnType<typeof vi.fn>;
    aiOpsLogFindFirst.mockReset();
    aiOpsLogFindFirst.mockResolvedValueOnce(null);
    jobMocks.enqueueJob.mockClear();

    await startAiOpsScanWorker();
    await new Promise((resolve) => setTimeout(resolve, 0));
    stopAiOpsScanWorkerForTests();

    expect(jobMocks.enqueueJob).toHaveBeenCalledTimes(1);
    const payload = jobMocks.enqueueJob.mock.calls[0]?.[0] as {
      payload?: { reason?: string };
    };
    expect(payload?.payload?.reason).toBe("startup");
  });
});
