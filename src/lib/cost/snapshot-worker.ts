/**
 * TR-031 E01: Cost tracking — daily snapshot worker.
 *
 * Aggregates the day's `cost_entries` into a `CostSnapshot` row once per
 * day. Idempotent: re-running the same day upserts the same row. The
 * snapshot is consumed by the /cost-summary trend chart and any future
 * BI / report surfaces.
 *
 * Pattern: same shape as `src/lib/operation-task/retention-worker.ts`
 *   - durable job type `cost.snapshot`
 *   - claimNextJob / heartbeatJob / completeJob / failJob
 *   - minute polling, durable daily targets and outage catch-up
 *   - globalThis state mirror for re-entrancy
 */
import { appTimeZoneDateKey, shiftAppTimeZoneDay, startOfDayInAppTimeZone, zonedDateTimeToDate } from "@/lib/datetime/time-zone";
import { CostDecimal } from "./service-internals";
import { isCalendarDate } from "./calendar-date";
import { z } from "zod";
import { activeJobClaim } from "@/lib/job/claim-context";
import { type Prisma } from "@prisma/client";

import { config } from "@/lib/config/env";
import { lockForTransaction } from "@/lib/concurrency/advisory-lock";
import { prisma } from "@/lib/db";
import { runWithLeaseHeartbeat } from "@/lib/job/heartbeat-runner";

function isLeaseLostError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { name?: unknown }).name === "LeaseLostError");
}
import { computeLeaseMs } from "@/lib/job/lease";
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  heartbeatJob,
} from "@/lib/job/service";
import { createLogger } from "@/lib/logging";
import { createSingletonIntervalWorker } from "@/lib/workers/singleton-interval-worker";

import { COST_CATEGORY_VALUES, type CostCategory } from "./types";
import {
  checkBudgetAlerts,
  syncServerMonthlyCosts,
  upsertDailySnapshot,
} from "./service";

const SNAPSHOT_CURRENCY = "CNY" as const;

const logger = createLogger("cost-snapshot-worker");

export const COST_SNAPSHOT_JOB_TYPE = "cost.snapshot";
const COST_SNAPSHOT_INTERVAL_MS = 60_000;
const COST_SNAPSHOT_LEASE_MS = computeLeaseMs("cost-snapshot");
const COST_SNAPSHOT_WORKER_ID = `${config.app.hostname || "vcontrolhub"}:cost-snapshot:${process.pid}`;

const costSnapshotWorker = createSingletonIntervalWorker({
  globalKey: "__vcontrolhubCostSnapshotWorker",
  resolveIntervalMs: () => COST_SNAPSHOT_INTERVAL_MS,
  tick: (_state, reason) => {
    void runCostSnapshotWorkerOnce(reason, true).catch((error) => {
      logger.error("Cost snapshot worker tick failed", {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  },
  onStarted: (_state, intervalMs) => {
    logger.info("Cost snapshot durable job worker started", {
      workerId: COST_SNAPSHOT_WORKER_ID,
      intervalMs,
    });
  },
});

async function enqueueCostSnapshotJob(reason: string) {
  await prisma.$transaction(async tx => {
    await lockForTransaction(tx, "cost-snapshot-enqueue", "global");
    const now = new Date();
    const today = appTimeZoneDateKey(now);
    const completed = await tx.job.findFirst({
      where: { type: COST_SNAPSHOT_JOB_TYPE, status: "COMPLETED" },
      orderBy: [{ completedAt: "desc" }, { id: "desc" }], select: { payload: true, createdAt: true },
    });
    let lastDay = completed && jobTargetDay(completed.payload, completed.createdAt);
    if (lastDay === today) return;
    if (!lastDay) {
      // Detached snapshot history survives job retention. A manual snapshot for
      // today is not evidence that monthly fees or budget alerts ran today.
      const snapshot = await tx.costSnapshot.findFirst({
        where: { snapshotDate: { lt: new Date(today) } }, orderBy: { snapshotDate: "desc" }, select: { snapshotDate: true },
      });
      lastDay = snapshot?.snapshotDate.toISOString().slice(0, 10) ?? null;
    }
    let day = now;
    if (lastDay && lastDay < today) {
      day = shiftAppTimeZoneDay(zonedDateTimeToDate(lastDay + "T12:00"), 1);
    } else if (!lastDay) {
      // An installation can fail its first job before writing a snapshot.
      const first = await tx.job.findFirst({ where: { type: COST_SNAPSHOT_JOB_TYPE }, orderBy: { createdAt: "asc" },
        select: { payload: true, createdAt: true } });
      if (first) day = zonedDateTimeToDate(jobTargetDay(first.payload, first.createdAt) + "T12:00");
    }
    for (; appTimeZoneDateKey(day) <= today; day = shiftAppTimeZoneDay(day, 1)) {
      const targetDay = appTimeZoneDateKey(day);
      const start = startOfDayInAppTimeZone(day), end = shiftAppTimeZoneDay(day, 1);
      const existing = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM jobs WHERE type = ${COST_SNAPSHOT_JOB_TYPE}
        AND (payload->>'targetDay' = ${targetDay}
          OR (payload->>'targetDay' IS NULL AND payload->>'requestedAt' >= ${start.toISOString()} AND payload->>'requestedAt' < ${end.toISOString()})
          OR (payload->>'targetDay' IS NULL AND payload->>'requestedAt' IS NULL AND "createdAt" >= ${start} AND "createdAt" < ${end}))
        LIMIT 1`;
      if (existing.length) continue;
      await enqueueJob({
        type: COST_SNAPSHOT_JOB_TYPE,
        title: "Cost daily aggregation snapshot",
        payload: { reason, requestedAt: day.toISOString(), targetDay },
        priority: -3, maxAttempts: 2,
      }, tx);
    }
  }, { timeout: 120_000 });
}

function jobTargetDay(payload: Prisma.JsonValue, createdAt: Date): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    if (typeof payload.targetDay === "string" && isCalendarDate(payload.targetDay)) return payload.targetDay;
    if (typeof payload.requestedAt === "string") return appTimeZoneDateKey(new Date(payload.requestedAt));
  }
  return appTimeZoneDateKey(createdAt);
}

async function buildDailySnapshot(targetDay: string) {
  const dayStart = new Date(targetDay);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  // DB-side aggregation — never silently drop rows beyond a take:N cap.
  const grouped = await prisma.costEntry.groupBy({
    by: ["category"],
    where: {
      effectiveDate: { gte: dayStart, lt: dayEnd },
      currency: SNAPSHOT_CURRENCY,
    },
    _sum: { amount: true },
    _count: { _all: true },
  });

  const byCategory = Object.fromEntries(
    COST_CATEGORY_VALUES.map((c) => [c, "0.00"]),
  ) as Record<CostCategory, string>;

  let total = new CostDecimal(0);
  let count = 0;
  for (const row of grouped) {
    const cat = (COST_CATEGORY_VALUES as readonly string[]).includes(
      row.category,
    )
      ? (row.category as CostCategory)
      : "other";
    const amount = new CostDecimal(row._sum.amount?.toString() ?? "0");
    byCategory[cat] = new CostDecimal(byCategory[cat]).plus(amount).toFixed(2);
    total = total.plus(amount);
    count += row._count._all;
  }

  return {
    snapshotDate: dayStart,
    totalAmount: total.toFixed(2),
    byCategory,
    entryCount: count,
  };
}

const snapshotProgress = z.object({
  day: z.string(),
  monthlySync: z.object({ month: z.string(), synced: z.number(), skipped: z.number() }),
  snapshot: z.object({ id: z.string(), snapshotDate: z.string(), totalAmount: z.string(), entryCount: z.number() }).optional(),
  budgetAlerts: z.object({ checked: z.number(), triggered: z.number(), notificationsSent: z.number() }).optional(),
});

export async function runCostSnapshotWorkerOnce(
  reason = "manual",
  drain = false,
): Promise<boolean> {
  const state = costSnapshotWorker.getState();
  if (state.running) {
    logger.warn(
      "Skipping cost snapshot tick because a previous tick is still running",
      {
        reason,
      },
    );
    return false;
  }

  state.running = true;
  try {
    await enqueueCostSnapshotJob(reason);
    let processed = false;
    do {
      if (!await processNextSnapshotJob(reason)) break;
      processed = true;
    } while (drain);
    return processed;
  } finally {
    state.running = false;
  }
}

async function processNextSnapshotJob(reason: string) {
  const job = await claimNextJob({
    workerId: COST_SNAPSHOT_WORKER_ID,
    types: [COST_SNAPSHOT_JOB_TYPE],
    leaseMs: COST_SNAPSHOT_LEASE_MS,
  });
  if (!job) return false;

  try {
    const lease = await heartbeatJob(job.id, COST_SNAPSHOT_WORKER_ID, {
      ...(job.attempts !== undefined ? { attempts: job.attempts } : {}),
      leaseMs: COST_SNAPSHOT_LEASE_MS,
      progress: "Syncing VPS monthly fees and aggregating daily cost",
    });
    if (lease && lease.count === 0) return true;
    const { monthlySync, snapshot, budgetAlerts } = await runWithLeaseHeartbeat({
      jobId: job.id,
      leaseMs: COST_SNAPSHOT_LEASE_MS,
      ...(job.attempts !== undefined ? { attempts: job.attempts } : {}),
      heartbeat: () => heartbeatJob(job.id, COST_SNAPSHOT_WORKER_ID, {
        ...(job.attempts !== undefined ? { attempts: job.attempts } : {}),
        leaseMs: COST_SNAPSHOT_LEASE_MS,
        progress: "Syncing VPS monthly fees and aggregating daily cost",
      }),
      run: async (signal) => {
        signal?.throwIfAborted();
        const day = jobTargetDay(job.payload, job.createdAt);
        const prior = snapshotProgress.safeParse(job.result);
        const saved = prior.success && prior.data.day === day ? prior.data : undefined;
        const monthlySync = saved?.monthlySync ?? await syncServerMonthlyCosts(day.slice(0, 7));
        signal?.throwIfAborted();
        // Completed effects are idempotent after a crash. On an ordinary failure,
        // checkpoint the successful sibling so a budget-only retry is independent.
        const [snapshot, alerts] = await Promise.allSettled([
          saved?.snapshot ?? buildDailySnapshot(day).then(upsertDailySnapshot),
          saved?.budgetAlerts ?? checkBudgetAlerts(zonedDateTimeToDate(`${day}T12:00`)),
        ]);
        if (snapshot.status === "rejected" || alerts.status === "rejected") {
          const progress = snapshotProgress.parse({
            day, monthlySync,
            snapshot: snapshot.status === "fulfilled" ? snapshot.value : undefined,
            budgetAlerts: alerts.status === "fulfilled" ? alerts.value : undefined,
          });
          await prisma.job.updateMany({
            where: activeJobClaim(job.id, COST_SNAPSHOT_WORKER_ID, job.attempts),
            data: { result: progress },
          });
        }
        if (snapshot.status === "rejected") throw snapshot.reason;
        if (alerts.status === "rejected") throw alerts.reason;
        return { monthlySync, snapshot: snapshot.value, budgetAlerts: alerts.value };
      },
    });
    await completeJob(job.id, COST_SNAPSHOT_WORKER_ID, {
      snapshotId: snapshot.id,
      snapshotDate: snapshot.snapshotDate,
      totalAmount: snapshot.totalAmount,
      entryCount: snapshot.entryCount,
      monthlySync: {
        month: monthlySync.month,
        synced: monthlySync.synced,
        skipped: monthlySync.skipped,
      },
      budgetAlerts: {
        checked: budgetAlerts.checked,
        triggered: budgetAlerts.triggered,
        notificationsSent: budgetAlerts.notificationsSent,
      },
      reason,
    }, ...(job.attempts !== undefined ? [job.attempts] : []));
    logger.info("Cost daily snapshot written", {
      snapshotId: snapshot.id,
      snapshotDate: snapshot.snapshotDate,
      totalAmount: snapshot.totalAmount,
      entryCount: snapshot.entryCount,
    });
    return true;
  } catch (error) {
    if (isLeaseLostError(error)) return true;
    const message =
      error instanceof Error
        ? error.message
        : "Cost daily snapshot aggregation failed";
    await failJob(job.id, COST_SNAPSHOT_WORKER_ID, message.slice(0, 2000), {
      ...(job.attempts !== undefined ? { attempts: job.attempts } : {}),
      retryAfterMs: 60 * 60 * 1000, // 1h retry
    });
    logger.error("Cost snapshot failed", {
      reason,
      jobId: job.id,
      error: message,
    });
    return true;
  }
}

export async function startCostSnapshotWorker() {
  return (await costSnapshotWorker.start()).state;
}

export function stopCostSnapshotWorkerForTests() {
  costSnapshotWorker.stopForTests();
}
