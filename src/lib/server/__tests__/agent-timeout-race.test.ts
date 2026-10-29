import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Agent timeouts and lease expiry against a stateful job store that applies the
 * same conditional updates the database would. A job the Agent has claimed
 * must never be reported as finished (or fall back to SSH) unless the Agent
 * itself reported; only a job that provably stayed PENDING may fall back.
 */
type Job = { id: string; serverId: string; status: string; completedAt: Date | null; exitCode: number | null; stdout: string | null; stderr: string | null; leaseExpiresAt: Date | null; claimedAt: Date | null; createdAt: Date; command: string };

const { jobs, hooks } = vi.hoisted(() => ({
  jobs: new Map<string, Job>(),
  hooks: { beforeUpdate: null as null | ((where: Record<string, unknown>) => void) },
}));

function matches(job: Job, where: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(where)) {
    if (key === "OR") { if (!(expected as Record<string, unknown>[]).some((clause) => matches(job, clause))) return false; continue; }
    const actual = (job as unknown as Record<string, unknown>)[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      const condition = expected as { in?: unknown[]; lt?: Date };
      if (condition.in && !condition.in.includes(actual)) return false;
      if (condition.lt && !(actual instanceof Date && actual.getTime() < condition.lt.getTime())) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

vi.mock("@/lib/db", () => {
  const serverAgentJob = {
    create: vi.fn(async ({ data }: { data: Partial<Job> }) => {
      const job: Job = { id: `job${jobs.size + 1}`, status: "PENDING", completedAt: null, exitCode: null, stdout: null, stderr: null, leaseExpiresAt: null, claimedAt: null, createdAt: new Date(), command: "", serverId: "srv1", ...data } as Job;
      jobs.set(job.id, job);
      return { ...job };
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (jobs.get(where.id) ? { ...jobs.get(where.id)! } : null)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const found = [...jobs.values()].find((job) => matches(job, where));
      return found ? { ...found } : null;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Job> }) => {
      hooks.beforeUpdate?.(where);
      let count = 0;
      for (const job of jobs.values()) if (matches(job, where)) { Object.assign(job, data); count += 1; }
      return { count };
    }),
  };
  const prisma = {
    server: { findUnique: vi.fn(async () => ({ operatingSystem: "LINUX", managementMode: "AGENT", agentLastSeenAt: new Date() })) },
    serverAgentJob,
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({ serverAgentJob })),
  };
  return { prisma };
});
vi.mock("@/lib/ssh/client", () => ({ buildSshParamsFromServer: vi.fn(), execRemoteCommand: vi.fn() }));
vi.mock("../monitor", () => ({ MONITOR_SCRIPT: "echo metrics" }));

import { CommandCancellationUnconfirmedError } from "@/lib/command/cancellation-error";
import { claimNextServerAgentJob, completeServerAgentJob, executeCommandWithAgent, heartbeatServerAgentJob } from "../agent-service";

beforeEach(() => {
  vi.useFakeTimers();
  jobs.clear();
  hooks.beforeUpdate = null;
});
afterEach(() => vi.useRealTimers());

async function settle<T>(promise: Promise<T>, ms: number) {
  const outcome = promise.then((value) => ({ value }), (error: unknown) => ({ error }));
  await vi.advanceTimersByTimeAsync(ms);
  return outcome;
}

describe("Agent command timeout", () => {
  it("falls back (null) only when the job provably never left PENDING", async () => {
    const outcome = await settle(executeCommandWithAgent({ serverId: "srv1", command: "uptime", timeoutMs: 1 }), 12_000);
    expect(outcome).toEqual({ value: null });
    expect(jobs.get("job1")).toMatchObject({ status: "CANCELLED", exitCode: 124 });
  });

  it("does not fall back to SSH when the Agent claims the job at the moment the deadline passes", async () => {
    // The last poll still saw PENDING; the Agent claims right before the
    // timeout's update. The old code cancelled PENDING-or-CLAIMED, then
    // returned null from its stale PENDING read → SSH ran the command again.
    hooks.beforeUpdate = (where) => {
      if (where.status === "PENDING" && jobs.get("job1")?.status === "PENDING") {
        Object.assign(jobs.get("job1")!, { status: "CLAIMED", claimedAt: new Date() });
      }
    };
    const outcome = await settle(executeCommandWithAgent({ serverId: "srv1", command: "systemctl restart app", timeoutMs: 1 }), 60_000);
    expect(outcome).not.toEqual({ value: null });
    expect(outcome).toEqual({ error: expect.any(CommandCancellationUnconfirmedError) });
    // A cancellation request for the live Agent, not a fabricated completion.
    expect(jobs.get("job1")).toMatchObject({ status: "CANCELLED", completedAt: null });
    expect(await heartbeatServerAgentJob({ serverId: "srv1", jobId: "job1" })).toBe(true);
  });

  it("returns the Agent's own report when it acknowledges the stop in time", async () => {
    const promise = executeCommandWithAgent({ serverId: "srv1", command: "sleep 600", timeoutMs: 1 });
    await vi.advanceTimersByTimeAsync(0); // job created, Agent claims it
    Object.assign(jobs.get("job1")!, { status: "CLAIMED", claimedAt: new Date() });
    const outcome = promise.then((value) => ({ value }), (error: unknown) => ({ error }));
    await vi.advanceTimersByTimeAsync(12_000); // past the deadline: cancel requested
    expect(jobs.get("job1")).toMatchObject({ status: "CANCELLED", completedAt: null });
    await completeServerAgentJob({ serverId: "srv1", jobId: "job1", exitCode: 130, stderr: "terminated" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await outcome).toEqual({ value: expect.objectContaining({ exitCode: 130, cancelled: true }) });
  });
});

describe("Agent job lease expiry", () => {
  it("records a cancellation request, not a completed job, and keeps the Agent's late result", async () => {
    jobs.set("job9", { id: "job9", serverId: "srv1", status: "CLAIMED", claimedAt: new Date(Date.now() - 120_000), leaseExpiresAt: new Date(Date.now() - 1_000), completedAt: null, exitCode: null, stdout: null, stderr: null, createdAt: new Date(), command: "long-task" });
    await claimNextServerAgentJob("srv1");
    expect(jobs.get("job9")).toMatchObject({ status: "CANCELLED", completedAt: null });
    // The Agent was only slow: it is told to stop and its real result lands.
    expect(await heartbeatServerAgentJob({ serverId: "srv1", jobId: "job9" })).toBe(true);
    await completeServerAgentJob({ serverId: "srv1", jobId: "job9", exitCode: 0, stdout: "done" });
    expect(jobs.get("job9")).toMatchObject({ status: "COMPLETED", stdout: "done", completedAt: expect.any(Date) });
  });
});

describe("PENDING jobs nobody claimed", () => {
  it("retires a job that outlived its own timeout and claims the next one", async () => {
    // The caller waits for the job's timeout and then cancels it; a job still PENDING long after that outlived a
    // caller that could not (the hub restarted). An Agent back from an outage must not run it with nobody waiting.
    jobs.clear();
    const base = { serverId: "srv1", status: "PENDING", completedAt: null, exitCode: null, stdout: null, stderr: null, leaseExpiresAt: null, claimedAt: null };
    jobs.set("stale", { ...base, id: "stale", command: "old", createdAt: new Date(Date.now() - 10 * 60_000), timeoutMs: 60_000 } as Job);
    jobs.set("fresh", { ...base, id: "fresh", command: "new", createdAt: new Date(), timeoutMs: 60_000 } as Job);

    const claimed = await claimNextServerAgentJob("srv1");
    expect(claimed?.id).toBe("fresh");
    expect(jobs.get("stale")).toMatchObject({ status: "CANCELLED", exitCode: 124 });
    expect(jobs.get("stale")?.completedAt).toBeInstanceOf(Date);
    expect(jobs.get("fresh")?.status).toBe("CLAIMED");
  });
});
