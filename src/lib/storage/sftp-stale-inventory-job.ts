/**
 * TR-005 T34a: SFTP stale inventory durable job worker.
 *
 * 每 30 分钟扫一轮 SFTP 节点, 给每个健康节点排一个
 * `storage.sftp-stale-inventory` job, worker 调
 * `detectAndPruneSftpStaleInventory` 走 read-only 远端扫描 + DB diff
 * + 软删除 stale 条目。
 *
 * 跟 `sftp-sync-job` 区别: 那个是用户主动触发的"补全 + 清理"全栈同步
 * (有 upsert), 本模块是后台周期的"只清理不补全" 兜底。
 *
 * 范式跟 `sftp-sync-job.ts` 一致: durable job pattern, 通过
 * `claimNextJob` + `completeJob` / `failJob` + `heartbeatJob` 走
 * jobs 表, 沿用 TR-001 T10/T12 已建好的基础设施。
 */
import { JobStatus, Prisma } from "@prisma/client";

import { config } from "@/lib/config/env";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { prisma } from "@/lib/db";
import { computeLeaseMs } from "@/lib/job/lease";
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  heartbeatJob,
} from "@/lib/job/service";
import { createLogger } from "@/lib/logging";
import { runWithLeaseHeartbeat } from "@/lib/job/heartbeat-runner";
import { createSingletonIntervalWorker } from "@/lib/workers/singleton-interval-worker";

import {
  detectAndPruneSftpStaleInventory,
  listSftpNodesForStaleInventory,
  type SftpStaleInventoryResult,
} from "./sftp-stale-inventory";

const logger = createLogger("sftp-stale-inventory-job-worker");

export const SFTP_STALE_INVENTORY_JOB_TYPE = "storage.sftp-stale-inventory";
export const SFTP_STALE_INVENTORY_JOB_TYPES = [
  SFTP_STALE_INVENTORY_JOB_TYPE,
] as const;

const SFTP_STALE_INVENTORY_INTERVAL_MS = 30 * 60_000; // 30 min
// TR-002 R2: 跨 worker lease 公式统一。full-tree 扫描大目录可能要 1-2 min。
const SFTP_STALE_INVENTORY_LEASE_MS = computeLeaseMs("sftp-stale-inventory");
const SFTP_STALE_INVENTORY_WORKER_ID = `${
  config.app.hostname || "vcontrolhub"
}:sftp-stale-inventory:${process.pid}`;

const DEFAULT_MAX_DEPTH = 5;

type SftpStaleInventoryJobPayload = {
  nodeId?: string;
  /** When set (including empty), only these node ids are scanned — used for team-scoped API "all" jobs. */
  nodeIds?: string[];
  maxDepth?: number;
  dryRun?: boolean;
  reason?: string;
};

const sftpStaleInventoryWorker = createSingletonIntervalWorker({
  globalKey: "__vcontrolhubSftpStaleInventoryWorker",
  resolveIntervalMs: () => SFTP_STALE_INVENTORY_INTERVAL_MS,
  tick: (state, reason) => {
    void runSftpStaleInventoryJobWorkerOnce(state, reason);
  },
  onStarted: (_state, intervalMs) => {
    logger.info("SFTP stale inventory worker started", {
      intervalMs,
      workerId: SFTP_STALE_INVENTORY_WORKER_ID,
    });
  },
});

function getWorkerState() {
  return sftpStaleInventoryWorker.getState();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseSftpStaleInventoryJobPayload(
  payload: Prisma.JsonValue,
): SftpStaleInventoryJobPayload {
  if (!isRecord(payload)) return {};
  const rawNodeIds = payload.nodeIds;
  const nodeIds = Array.isArray(rawNodeIds)
    ? rawNodeIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      )
    : undefined;
  return {
    nodeId: typeof payload.nodeId === "string" ? payload.nodeId : undefined,
    // Preserve empty array: team-scoped "all" with zero visible nodes must not widen to global.
    nodeIds: Array.isArray(rawNodeIds) ? nodeIds : undefined,
    maxDepth:
      typeof payload.maxDepth === "number" && Number.isFinite(payload.maxDepth)
        ? Math.max(0, Math.min(10, Math.floor(payload.maxDepth)))
        : undefined,
    dryRun: typeof payload.dryRun === "boolean" ? payload.dryRun : undefined,
    reason: typeof payload.reason === "string" ? payload.reason : undefined,
  };
}

async function scanOneNode(input: {
  node: Awaited<ReturnType<typeof listSftpNodesForStaleInventory>>[number];
  maxDepth?: number;
  dryRun?: boolean;
}): Promise<SftpStaleInventoryResult> {
  // Skip unhealthy nodes (P-001-A pattern: 失败节点不重复扫描)
  if (input.node.healthStatus === "UNHEALTHY") {
    logger.warn("Skipping stale inventory for unhealthy SFTP node", {
      nodeId: input.node.id,
      nodeName: input.node.name,
      lastError: input.node.lastHealthError,
    });
    return {
      nodeId: input.node.id,
      nodeName: input.node.name,
      basePath: input.node.basePath,
      scanned: 0,
      stale: 0,
      errors: [
        `Node health status is UNHEALTHY, skipped: ${input.node.lastHealthError ?? "unknown"}`,
      ],
      durationMs: 0,
      dryRun: input.dryRun ?? false,
    };
  }

  return detectAndPruneSftpStaleInventory({
    // The list helper returns rows with extra healthStatus fields
    // (UNHEALTHY detection happens in scanOneNode, before this is
    // called), so the structural shape is compatible with SftpSyncNode.
    node: input.node as unknown as Parameters<
      typeof detectAndPruneSftpStaleInventory
    >[0]["node"],
    maxDepth: input.maxDepth,
    dryRun: input.dryRun,
  });
}

/**
 * Scan one node under the lease-heartbeat wrapper (TR: two verbatim copies
 * used to sit inline in the single-node and multi-node sweep branches).
 * Keeps the durable-job lease renewed while a full-tree scan runs long.
 */
function scanNodeWithHeartbeat(
  job: { id: string },
  node: Awaited<ReturnType<typeof listSftpNodesForStaleInventory>>[number],
  maxDepth: number,
  dryRun: boolean,
): Promise<SftpStaleInventoryResult> {
  return runWithLeaseHeartbeat({
    jobId: job.id,
    leaseMs: SFTP_STALE_INVENTORY_LEASE_MS,
    heartbeat: () =>
      heartbeatJob(job.id, SFTP_STALE_INVENTORY_WORKER_ID, {
        leaseMs: SFTP_STALE_INVENTORY_LEASE_MS,
        progress: `Scanning ${node.name}`,
      }),
    run: () => scanOneNode({ node, maxDepth, dryRun }),
  });
}

async function executeStaleInventoryJob(job: {
  id: string;
  payload: Prisma.JsonValue;
}) {
  const payload = parseSftpStaleInventoryJobPayload(job.payload);
  const maxDepth = payload.maxDepth ?? DEFAULT_MAX_DEPTH;
  const dryRun = payload.dryRun ?? false;

  await heartbeatJob(job.id, SFTP_STALE_INVENTORY_WORKER_ID, {
    leaseMs: SFTP_STALE_INVENTORY_LEASE_MS,
    progress: payload.nodeId
      ? `Scanning node ${payload.nodeId}`
      : payload.nodeIds
        ? `Scanning scoped SFTP nodes (${payload.nodeIds.length})`
        : "Scanning all SFTP nodes",
  });

  if (payload.nodeId) {
    // System worker path: node id was validated at enqueue (API) or is system-scheduled.
    const nodes = await listSftpNodesForStaleInventory();
    const node = nodes.find((n) => n.id === payload.nodeId);
    if (!node) {
      throw new Error(`Storage node not found: ${payload.nodeId}`);
    }
    const result = await scanNodeWithHeartbeat(job, node, maxDepth, dryRun);
    logSweepNodeErrors(job.id, "single", [result]);
    await completeJob(job.id, SFTP_STALE_INVENTORY_WORKER_ID, {
      mode: "single",
      results: [result],
      totals: summarize([result]),
    } as unknown as Prisma.InputJsonValue);
    return;
  }

  // nodeIds present (including []) => team-scoped multi-node job; never widen to global.
  let nodes = await listSftpNodesForStaleInventory();
  if (payload.nodeIds !== undefined) {
    const allowed = new Set(payload.nodeIds);
    nodes = nodes.filter((n) => allowed.has(n.id));
  }

  if (nodes.length === 0) {
    await completeJob(job.id, SFTP_STALE_INVENTORY_WORKER_ID, {
      mode: payload.nodeIds !== undefined ? "scoped" : "all",
      results: [],
      totals: { nodes: 0, scanned: 0, stale: 0, errors: 0, durationMs: 0 },
    } as unknown as Prisma.InputJsonValue);
    return;
  }

  const results: SftpStaleInventoryResult[] = [];
  for (const node of nodes) {
    await heartbeatJob(job.id, SFTP_STALE_INVENTORY_WORKER_ID, {
      leaseMs: SFTP_STALE_INVENTORY_LEASE_MS,
      progress: `Scanning ${node.name} (${nodes.indexOf(node) + 1}/${nodes.length})`,
    });
    const result = await scanNodeWithHeartbeat(job, node, maxDepth, dryRun);
    results.push(result);
  }

  logSweepNodeErrors(job.id, payload.nodeIds !== undefined ? "scoped" : "all", results);
  await completeJob(job.id, SFTP_STALE_INVENTORY_WORKER_ID, {
    mode: payload.nodeIds !== undefined ? "scoped" : "all",
    results,
    totals: summarize(results),
  } as unknown as Prisma.InputJsonValue);
}

function summarize(results: SftpStaleInventoryResult[]) {
  return {
    nodes: results.length,
    scanned: results.reduce((sum, r) => sum + r.scanned, 0),
    stale: results.reduce((sum, r) => sum + r.stale, 0),
    errors: results.reduce((sum, r) => sum + r.errors.length, 0),
    durationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
  };
}

/**
 * A node result carrying only an "…skipped" error (UNHEALTHY node, non-SFTP
 * type) is a BENIGN, by-design skip (P-001-A: don't repeatedly scan failed
 * nodes — health is tracked separately). A node with any other error string
 * had a *real* scan failure (credentials unavailable, DB diff failed, a
 * directory listing threw).
 */
function realErrorsOf(result: SftpStaleInventoryResult): string[] {
  return result.errors.filter((e) => !/\bskipped\b/i.test(e));
}

/**
 * scanOneNode never throws — it records per-node failures in `result.errors`
 * so the job can still completeJob and persist the structured per-node
 * diagnostics (a failJob would drop that payload for a bare error string).
 * The tradeoff is that a sweep whose nodes all failed to scan still reports
 * COMPLETED, indistinguishable from a healthy sweep at the job.status level —
 * invisible to status-based alerting. Surface real (non-skip) per-node errors
 * into the log so they are not silently buried in the result JSON.
 */
function logSweepNodeErrors(
  jobId: string,
  mode: string,
  results: SftpStaleInventoryResult[],
): void {
  const failedNodes = results
    .map((r) => ({ result: r, real: realErrorsOf(r) }))
    .filter((x) => x.real.length > 0);
  if (failedNodes.length === 0) return;
  logger.warn("SFTP stale inventory sweep completed with per-node scan errors", {
    jobId,
    mode,
    failedNodeCount: failedNodes.length,
    totalNodes: results.length,
    nodes: failedNodes.map((x) => ({
      nodeId: x.result.nodeId,
      nodeName: x.result.nodeName,
      scanned: x.result.scanned,
      errors: x.real,
    })),
  });
}

/**
 * Periodic PRODUCER for the background stale-inventory sweep.
 *
 * The worker tick is a pure consumer (`claimNextJob`); without a producer,
 * nothing enqueues a system-wide sweep, so the "background periodic cleanup"
 * documented at the top of this module only ran when a human hit the API route.
 * Mirror of health sampling's `enqueueHealthSampleIfIdle`: enqueue at most one
 * GLOBAL (all-nodes) sweep at a time, gated by an advisory lock plus an
 * already-in-flight check, so repeated ticks (and manual API jobs) never stack.
 *
 * A global sweep carries no `nodeId`/`nodeIds` in its payload, so
 * `executeStaleInventoryJob` scans every node returned by
 * `listSftpNodesForStaleInventory()`.
 */
export async function enqueueSftpStaleInventorySweepIfIdle(
  reason: string,
): Promise<boolean> {
  const release = await acquireAdvisoryLock(
    "sftp-stale-inventory-enqueue",
    "global",
  );
  try {
    const active = await prisma.job.findFirst({
      where: {
        type: SFTP_STALE_INVENTORY_JOB_TYPE,
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
      },
      select: { id: true },
    });
    if (active) return false;
    await enqueueJob({
      type: SFTP_STALE_INVENTORY_JOB_TYPE,
      title: "SFTP stale inventory sweep (all nodes)",
      payload: { reason },
      maxAttempts: 1,
    });
    return true;
  } finally {
    await release();
  }
}

export async function runSftpStaleInventoryJobWorkerOnce(
  state = getWorkerState(),
  reason = "manual",
) {
  if (state.running) {
    logger.warn(
      "Skipping SFTP stale inventory tick because a previous tick is still running",
      { reason },
    );
    return false;
  }

  state.running = true;
  try {
    // Periodic PRODUCER: without this the tick below is a pure consumer, so a
    // system-wide sweep was only ever enqueued by the manual API route — the
    // "background periodic cleanup" this module documents never actually ran.
    // Mirror of health sampling's enqueueHealthSampleIfIdle.
    await enqueueSftpStaleInventorySweepIfIdle(reason);
    const job = await claimNextJob({
      workerId: SFTP_STALE_INVENTORY_WORKER_ID,
      types: [...SFTP_STALE_INVENTORY_JOB_TYPES],
      leaseMs: SFTP_STALE_INVENTORY_LEASE_MS,
    });
    if (!job) return false;

    try {
      await executeStaleInventoryJob(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("SFTP stale inventory job failed", {
        reason,
        jobId: job.id,
        error: message,
      });
      await failJob(job.id, SFTP_STALE_INVENTORY_WORKER_ID, message, {
        retryAfterMs: 5 * 60_000,
      });
    }
    return true;
  } catch (error) {
    logger.error("SFTP stale inventory job tick failed", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  } finally {
    state.running = false;
  }
}

export async function startSftpStaleInventoryWorker() {
  return (await sftpStaleInventoryWorker.start()).state;
}

export function stopSftpStaleInventoryWorkerForTests() {
  sftpStaleInventoryWorker.stopForTests();
}
