/**
 * Background traffic sampling (local hub NIC + optional remote VPS NICs).
 *
 * Why this exists:
 * - /api/traffic/summary only wrote TrafficSnapshot when a user opened /traffic.
 * - History charts were empty on a quiet control plane even though health
 *   sampling was running.
 *
 * Design:
 * - Durable job type `traffic.sample`, every 5 minutes.
 * - Always sample the local primary interface from /proc/net/dev.
 * - Best-effort remote sampling for enabled servers (SSH cat /proc/net/dev).
 * - Persist one row per primary interface sample into traffic_snapshots.
 * - Prune completed traffic.sample jobs after each successful tick.
 */
import { readFileSync } from "node:fs";
import { JobStatus } from "@prisma/client";

import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { computeLeaseMs } from "@/lib/job/lease";
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  heartbeatJob,
  pruneCompletedJobsByType,
} from "@/lib/job/service";
import { createLogger } from "@/lib/logging";
import {
  calculateTrafficRate,
  parseNetworkDeviceStats,
  selectPrimaryInterface,
  type NetworkDeviceStats,
  type TrafficCounterSample,
} from "@/lib/monitoring/traffic";
import {
  sampleRemoteServersTraffic,
  type RemoteServerInput,
} from "@/lib/monitoring/remote-traffic";

export const TRAFFIC_SAMPLING_JOB_TYPE = "traffic.sample";

const TRAFFIC_SAMPLE_INTERVAL_MS = 5 * 60_000;
const TRAFFIC_SAMPLE_LEASE_MS = computeLeaseMs("traffic-sampling");
const TRAFFIC_SAMPLE_WORKER_ID = `${config.app.hostname || "vcontrolhub"}:traffic-sampling:${process.pid}`;
const TRAFFIC_SAMPLE_JOB_KEEP_LATEST = 50;
const TRAFFIC_SAMPLE_JOB_RETENTION_DAYS = 7;
const TRAFFIC_SNAPSHOT_RETENTION_DAYS = 14;
const REMOTE_SAMPLE_LIMIT = 20;
const logger = createLogger("traffic-sampling-worker");

const previousLocalSamples = new Map<string, TrafficCounterSample>();

type WorkerState = {
  started: boolean;
  running: boolean;
  timer: NodeJS.Timeout | null;
};

type WorkerGlobal = typeof globalThis & {
  __vcontrolhubTrafficSamplingWorker?: WorkerState;
};

function getWorkerState(): WorkerState {
  const globalState = globalThis as WorkerGlobal;
  globalState.__vcontrolhubTrafficSamplingWorker ??= {
    started: false,
    running: false,
    timer: null,
  };
  return globalState.__vcontrolhubTrafficSamplingWorker;
}

function readProcNetDev() {
  try {
    return readFileSync("/proc/net/dev", "utf-8");
  } catch {
    return "";
  }
}

async function persistTrafficSample(input: {
  source: string;
  serverId: string | null;
  iface: string;
  rxBytes: number;
  txBytes: number;
  rxRateBps: number;
  txRateBps: number;
}) {
  await prisma.trafficSnapshot.create({
    data: {
      source: input.source,
      serverId: input.serverId,
      iface: input.iface,
      rxBytes: BigInt(Math.max(0, Math.trunc(input.rxBytes))),
      txBytes: BigInt(Math.max(0, Math.trunc(input.txBytes))),
      rxRateBps: Math.max(0, input.rxRateBps),
      txRateBps: Math.max(0, input.txRateBps),
    },
  });
}

function summarizeLocalInterface(iface: string, sample: NetworkDeviceStats) {
  const key = `local:${iface}`;
  const current: TrafficCounterSample = {
    rxBytes: sample.rxBytes,
    txBytes: sample.txBytes,
    sampledAt: new Date().toISOString(),
  };
  const previous = previousLocalSamples.get(key) ?? null;
  previousLocalSamples.set(key, current);
  const rate = calculateTrafficRate(previous, current);
  return {
    iface,
    rxBytes: sample.rxBytes,
    txBytes: sample.txBytes,
    rxRateBps: rate.rxBytesPerSecond,
    txRateBps: rate.txBytesPerSecond,
  };
}

async function sampleLocalPrimary(): Promise<{
  sampled: boolean;
  iface: string | null;
}> {
  const interfaces = parseNetworkDeviceStats(readProcNetDev());
  const primary = selectPrimaryInterface(interfaces);
  if (!primary) return { sampled: false, iface: null };
  const summary = summarizeLocalInterface(primary.iface, primary);
  await persistTrafficSample({
    source: "local",
    serverId: null,
    iface: summary.iface,
    rxBytes: summary.rxBytes,
    txBytes: summary.txBytes,
    rxRateBps: summary.rxRateBps,
    txRateBps: summary.txRateBps,
  });
  return { sampled: true, iface: summary.iface };
}

async function sampleRemotePrimaries(): Promise<{
  attempted: number;
  sampled: number;
  failed: number;
}> {
  const servers = (await prisma.server.findMany({
    where: { enabled: true },
    select: {
      id: true,
      name: true,
      host: true,
      port: true,
      username: true,
      password: true,
      sshKeyId: true,
      sshKey: { select: { privateKey: true } },
    },
    orderBy: { name: "asc" },
    take: REMOTE_SAMPLE_LIMIT,
  })) as RemoteServerInput[];

  if (servers.length === 0) {
    return { attempted: 0, sampled: 0, failed: 0 };
  }

  const results = await sampleRemoteServersTraffic(servers);
  let sampled = 0;
  let failed = 0;
  for (const result of results) {
    if (result.error || !result.primaryInterface) {
      failed += 1;
      continue;
    }
    const iface = result.primaryInterface;
    try {
      await persistTrafficSample({
        source: "server",
        serverId: result.serverId,
        iface: iface.iface,
        rxBytes: iface.rxBytes,
        txBytes: iface.txBytes,
        rxRateBps: iface.rxRateBytesPerSecond,
        txRateBps: iface.txRateBytesPerSecond,
      });
      sampled += 1;
    } catch (error) {
      failed += 1;
      logger.warn("Failed to persist remote traffic sample", {
        serverId: result.serverId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { attempted: results.length, sampled, failed };
}

async function pruneOldTrafficSnapshots() {
  const olderThan = new Date(Date.now() - TRAFFIC_SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return prisma.trafficSnapshot.deleteMany({
    where: { sampledAt: { lt: olderThan } },
  });
}

async function hasActiveTrafficSampleJob() {
  const existing = await prisma.job.findFirst({
    where: {
      type: TRAFFIC_SAMPLING_JOB_TYPE,
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
    },
    select: { id: true },
  });
  return Boolean(existing);
}

export async function enqueueTrafficSampleIfIdle(reason: string) {
  if (await hasActiveTrafficSampleJob()) return false;
  await enqueueJob({
    type: TRAFFIC_SAMPLING_JOB_TYPE,
    title: "Background traffic sampling",
    payload: { reason, requestedAt: new Date().toISOString() },
    priority: -8,
    maxAttempts: 2,
  });
  return true;
}

async function processSample(jobId: string) {
  await heartbeatJob(jobId, TRAFFIC_SAMPLE_WORKER_ID, {
    leaseMs: TRAFFIC_SAMPLE_LEASE_MS,
    progress: "Sampling local and remote traffic counters",
  });

  const local = await sampleLocalPrimary();
  const remote = await sampleRemotePrimaries();
  const pruned = await pruneOldTrafficSnapshots();

  return {
    localSampled: local.sampled,
    localIface: local.iface,
    remoteAttempted: remote.attempted,
    remoteSampled: remote.sampled,
    remoteFailed: remote.failed,
    prunedSnapshots: pruned.count,
  };
}

export async function runTrafficSamplingWorkerOnce(reason = "manual") {
  const state = getWorkerState();
  if (state.running) {
    logger.warn("Skipping traffic sample tick because a previous tick is still running", { reason });
    return false;
  }

  state.running = true;
  try {
    await enqueueTrafficSampleIfIdle(reason);
    const job = await claimNextJob({
      workerId: TRAFFIC_SAMPLE_WORKER_ID,
      types: [TRAFFIC_SAMPLING_JOB_TYPE],
      leaseMs: TRAFFIC_SAMPLE_LEASE_MS,
    });
    if (!job) return false;

    try {
      const result = await processSample(job.id);
      await completeJob(job.id, TRAFFIC_SAMPLE_WORKER_ID, result);
      try {
        await pruneCompletedJobsByType({
          type: TRAFFIC_SAMPLING_JOB_TYPE,
          keepLatest: TRAFFIC_SAMPLE_JOB_KEEP_LATEST,
          olderThan: new Date(Date.now() - TRAFFIC_SAMPLE_JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000),
        });
      } catch (pruneError) {
        logger.warn("Failed to prune traffic.sample jobs", {
          error: pruneError instanceof Error ? pruneError.message : String(pruneError),
        });
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await failJob(job.id, TRAFFIC_SAMPLE_WORKER_ID, message.slice(0, 2000), {
        retryAfterMs: 60_000,
      });
      logger.error("Traffic sample failed", { reason, jobId: job.id, error: message });
      return true;
    }
  } finally {
    state.running = false;
  }
}

export async function startTrafficSamplingWorker() {
  const state = getWorkerState();
  if (state.started) return state;

  state.started = true;
  void runTrafficSamplingWorkerOnce("startup").catch((error) => {
    logger.error("Traffic sampling worker startup tick failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  state.timer = setInterval(() => {
    void runTrafficSamplingWorkerOnce("interval").catch((error) => {
      logger.error("Traffic sampling worker interval tick failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, TRAFFIC_SAMPLE_INTERVAL_MS);

  logger.info("traffic sampling durable job worker started", {
    intervalMs: TRAFFIC_SAMPLE_INTERVAL_MS,
    workerId: TRAFFIC_SAMPLE_WORKER_ID,
  });
  return state;
}

export function stopTrafficSamplingWorkerForTests() {
  const state = getWorkerState();
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.started = false;
  state.running = false;
  previousLocalSamples.clear();
}
