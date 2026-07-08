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
import { Prisma } from "@prisma/client";

import { config } from "@/lib/config/env";
import { computeLeaseMs } from "@/lib/job/lease";
import { claimNextJob, completeJob, failJob, heartbeatJob } from "@/lib/job/service";
import { createLogger } from "@/lib/logging";

import {
  detectAndPruneSftpStaleInventory,
  listSftpNodesForStaleInventory,
  type SftpStaleInventoryResult,
} from "./sftp-stale-inventory";

const logger = createLogger("sftp-stale-inventory-job-worker");

export const SFTP_STALE_INVENTORY_JOB_TYPE = "storage.sftp-stale-inventory";
export const SFTP_STALE_INVENTORY_JOB_TYPES = [SFTP_STALE_INVENTORY_JOB_TYPE] as const;

const SFTP_STALE_INVENTORY_INTERVAL_MS = 30 * 60_000; // 30 min
// TR-002 R2: 跨 worker lease 公式统一。full-tree 扫描大目录可能要 1-2 min。
const SFTP_STALE_INVENTORY_LEASE_MS = computeLeaseMs("sftp-stale-inventory");
const SFTP_STALE_INVENTORY_WORKER_ID = `${
  config.app.hostname || "vcontrolhub"
}:sftp-stale-inventory:${process.pid}`;

const DEFAULT_MAX_DEPTH = 5;

type SftpStaleInventoryJobPayload = {
  nodeId?: string;
  maxDepth?: number;
  dryRun?: boolean;
  reason?: string;
};

type SftpStaleInventoryWorkerState = {
  started: boolean;
  running: boolean;
  timer: NodeJS.Timeout | null;
};

type SftpStaleInventoryWorkerGlobal = typeof globalThis & {
  __vcontrolhubSftpStaleInventoryWorker?: SftpStaleInventoryWorkerState;
};

function getWorkerState() {
  const globalState = globalThis as SftpStaleInventoryWorkerGlobal;
  globalState.__vcontrolhubSftpStaleInventoryWorker ??= {
    started: false,
    running: false,
    timer: null,
  };
  return globalState.__vcontrolhubSftpStaleInventoryWorker;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseSftpStaleInventoryJobPayload(
  payload: Prisma.JsonValue,
): SftpStaleInventoryJobPayload {
  if (!isRecord(payload)) return {};
  return {
    nodeId: typeof payload.nodeId === "string" ? payload.nodeId : undefined,
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
      errors: [`Node health status is UNHEALTHY, skipped: ${input.node.lastHealthError ?? "unknown"}`],
      durationMs: 0,
      dryRun: input.dryRun ?? false,
    };
  }

  return detectAndPruneSftpStaleInventory({
    // The list helper returns rows with extra healthStatus fields
    // (UNHEALTHY detection happens in scanOneNode, before this is
    // called), so the structural shape is compatible with SftpSyncNode.
    node: input.node as unknown as Parameters<typeof detectAndPruneSftpStaleInventory>[0]["node"],
    maxDepth: input.maxDepth,
    dryRun: input.dryRun,
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
      : "Scanning all SFTP nodes",
  });

  if (payload.nodeId) {
    const nodes = await listSftpNodesForStaleInventory();
    const node = nodes.find((n) => n.id === payload.nodeId);
    if (!node) {
      throw new Error(`Storage node not found: ${payload.nodeId}`);
    }
    const result = await scanOneNode({ node, maxDepth, dryRun });
    await completeJob(job.id, SFTP_STALE_INVENTORY_WORKER_ID, {
      mode: "single",
      results: [result],
      totals: summarize([result]),
    } as unknown as Prisma.InputJsonValue);
    return;
  }

  const nodes = await listSftpNodesForStaleInventory();
  if (nodes.length === 0) {
    await completeJob(job.id, SFTP_STALE_INVENTORY_WORKER_ID, {
      mode: "all",
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
    const result = await scanOneNode({ node, maxDepth, dryRun });
    results.push(result);
  }

  await completeJob(job.id, SFTP_STALE_INVENTORY_WORKER_ID, {
    mode: "all",
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
  const state = getWorkerState();
  if (state.started) return state;

  state.started = true;
  const intervalMs = SFTP_STALE_INVENTORY_INTERVAL_MS;

  void runSftpStaleInventoryJobWorkerOnce(state, "startup");
  state.timer = setInterval(() => {
    void runSftpStaleInventoryJobWorkerOnce(state, "interval");
  }, intervalMs);
  state.timer.unref?.();

  logger.info("SFTP stale inventory worker started", {
    intervalMs,
    workerId: SFTP_STALE_INVENTORY_WORKER_ID,
  });
  return state;
}

export function stopSftpStaleInventoryWorkerForTests() {
  const state = getWorkerState();
  if (state.timer) clearInterval(state.timer);
  state.started = false;
  state.running = false;
  state.timer = null;
}
