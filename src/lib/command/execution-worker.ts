import { config } from "@/lib/config/env";
import { LeaseLostError, runWithLeaseHeartbeat } from "@/lib/job/heartbeat-runner";
import { computeLeaseMs } from "@/lib/job/lease";
import { recordJobEvent } from "@/lib/job/events";
import { claimNextJob, completeJob, failJob, heartbeatJob } from "@/lib/job/service";
import { createLogger } from "@/lib/logging";
import { createSingletonIntervalWorker } from "@/lib/workers/singleton-interval-worker";

import { executeAndFinalizeCommand, markCommandExecutionFailed } from "./service-execution";
import {
  COMMAND_EXECUTION_JOB_TYPE,
  parseCommandExecutionJobPayload,
  type CommandExecutionJobPayload,
} from "./execution-queue";

export {
  COMMAND_EXECUTION_JOB_TYPE,
  enqueueCommandExecutionJob,
  parseCommandExecutionJobPayload,
} from "./execution-queue";

const logger = createLogger("command-execution-worker");

// TR-001 (T11): command execution migrated to the durable jobs table so the
// actual SSH dispatch is observable in the Operation Tasks center, survives
// process restarts (claim + lease), and follows the same shape as the other
// durable workers (alert.evaluate, scheduled-task.tick, quick_service.lifecycle,
// backup.create / backup.restore). Deployment runs that delegate to
// createCommandRequest automatically inherit the new path.
// TR-002 R2: 跨 worker lease 公式统一。computeLeaseMs 默认返 preset (= COMMAND_EXECUTION_LEASE_MS 等同原值)。
const COMMAND_EXECUTION_LEASE_MS = computeLeaseMs("command-execution");
const COMMAND_EXECUTION_WORKER_ID = `${config.app.hostname || "vcontrolhub"}:command-execution:${process.pid}`;

const commandExecutionWorker = createSingletonIntervalWorker({
  globalKey: "__vcontrolhubCommandExecutionWorker",
  resolveIntervalMs: () => config.worker.commandExecutionIntervalMs,
  tick: (_state, reason) => {
    void runCommandExecutionJobWorkerOnce().catch((error) => {
      logger.error(
        reason === "startup" ? "Command execution worker startup tick failed" : "Command execution worker interval tick failed",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    });
  },
  onStarted: (_state, intervalMs) => {
    logger.info("command execution durable job worker started", {
      intervalMs,
      workerId: COMMAND_EXECUTION_WORKER_ID,
    });
  },
});

function getWorkerState() {
  return commandExecutionWorker.getState();
}

async function handleClaimedJob(
  job: NonNullable<Awaited<ReturnType<typeof claimNextJob>>>,
) {
  let payload: CommandExecutionJobPayload;
  try {
    payload = parseCommandExecutionJobPayload(job.payload);
  } catch (parseError) {
    const message =
      parseError instanceof Error ? parseError.message : "Command execution task payload parse failed";
    await failJob(job.id, COMMAND_EXECUTION_WORKER_ID, message.slice(0, 2000), { attempts: job.attempts });
    logger.error("Command execution job payload invalid", { jobId: job.id, error: message });
    return true;
  }

  // CommandRequest has its own heartbeat, but the durable Job lease is separate.
  // Without mid-SSH job heartbeats, claimNextJob can reclaim this RUNNING job
  // after lease expiry and start a second executeAndFinalizeCommand (duplicate SSH).
  try {
    const initialLease = await heartbeatJob(job.id, COMMAND_EXECUTION_WORKER_ID, {
      attempts: job.attempts,
      leaseMs: COMMAND_EXECUTION_LEASE_MS,
      progress: `Dispatching command request ${payload.commandRequestId}`,
    });
    if (!initialLease.count) return true;
    const finalRequest = await runWithLeaseHeartbeat({
      jobId: job.id, leaseMs: COMMAND_EXECUTION_LEASE_MS,
      heartbeat: () => heartbeatJob(job.id, COMMAND_EXECUTION_WORKER_ID, {
        attempts: job.attempts, leaseMs: COMMAND_EXECUTION_LEASE_MS, progress: `Executing command request ${payload.commandRequestId}`,
      }),
      run: signal => executeAndFinalizeCommand(payload.commandRequestId, signal),
    });
    const terminalStatus = finalRequest?.status ?? null;
    // Avoid "false success": COMPLETED job must not hide a FAILED command.
    // Operation Tasks previously showed job COMPLETED even when every SSH
    // target failed — only the command row status reflected failure.
    if (terminalStatus === "FAILED" || terminalStatus === "CANCELLED") {
      await failJob(
        job.id,
        COMMAND_EXECUTION_WORKER_ID,
        `Command request ${payload.commandRequestId} ended with ${terminalStatus}`,
        { attempts: job.attempts },
      );
      return true;
    }
    await completeJob(job.id, COMMAND_EXECUTION_WORKER_ID, {
      commandRequestId: payload.commandRequestId,
      status: terminalStatus,
    }, job.attempts);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof LeaseLostError) return true;
    // Ensure commandRequest/targets leave RUNNING if finalize threw mid-flight.
    // Previously this path only failed the job row, so the request could stay
    // RUNNING until a separate recovery sweep (false "still running" UX).
    try {
      await markCommandExecutionFailed(payload.commandRequestId, error);
    } catch (markError) {
      logger.error("markCommandExecutionFailed failed after execution error", {
        jobId: job.id,
        commandRequestId: payload.commandRequestId,
        error: markError instanceof Error ? markError.message : String(markError),
      });
    }
    await failJob(job.id, COMMAND_EXECUTION_WORKER_ID, message.slice(0, 2000), { attempts: job.attempts });
    logger.error("Command execution job failed", {
      jobId: job.id,
      commandRequestId: payload.commandRequestId,
      error: message,
    });
    return true;
  }
}

/**
 * Commands handled at once per process (A6-08). One at a time meant a single
 * long command held every other command, playbook step and deployment behind
 * it for up to its whole execution timeout; downloads already run three-wide.
 */
const MAX_CONCURRENT_COMMAND_JOBS = 3;
let activeCommandJobs = 0;

const inFlight = new Set<Promise<boolean>>();
const claimedJobs = new Map<string, number>();
let stopping = false;

export function runCommandExecutionJobWorkerOnce() {
  if (stopping) return Promise.resolve(false);
  const work = claimAndRunCommand();
  inFlight.add(work);
  void work.finally(() => inFlight.delete(work));
  return work;
}

async function claimAndRunCommand() {
  const state = getWorkerState();
  // `running` guards the claim only (two ticks must not claim at the same moment); the job then runs beside the others.
  if (state.running) {
    logger.warn("Skipping command execution tick because a previous tick is still running");
    return false;
  }
  if (activeCommandJobs >= MAX_CONCURRENT_COMMAND_JOBS) return false;

  state.running = true;
  let counted = false;
  try {
    const job = await claimNextJob({
      workerId: COMMAND_EXECUTION_WORKER_ID,
      types: [COMMAND_EXECUTION_JOB_TYPE],
      leaseMs: COMMAND_EXECUTION_LEASE_MS,
    });
    if (!job) return false;
    activeCommandJobs += 1;
    counted = true;
    state.running = false;
    claimedJobs.set(job.id, job.attempts);
    try { return await handleClaimedJob(job); }
    finally { claimedJobs.delete(job.id); }
  } catch (error) {
    logger.error("Command execution worker tick failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  } finally {
    if (counted) activeCommandJobs -= 1;
    if (!counted) state.running = false;
  }
}

export async function startCommandExecutionWorker(options: { intervalMs?: number } = {}) {
  stopping = false;
  return (await commandExecutionWorker.start(options)).state;
}

/** Leave time inside the standalone worker's ten-second deadline for the handoff and connection teardown. */
export async function drainCommandExecutionWorker(timeoutMs = 8000) {
  stopping = true;
  commandExecutionWorker.stopForTests();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const drained = await Promise.race([
      Promise.allSettled([...inFlight]).then(() => true),
      new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
    if (!drained) {
      await Promise.all([...claimedJobs].map(([jobId, attempts]) => recordJobEvent({
        jobId, type: "progress", level: "warn", workerId: COMMAND_EXECUTION_WORKER_ID,
        message: "Worker stopped before command result confirmation", payload: { attempts, handoff: true },
      })));
    }
    return drained;
  } finally { clearTimeout(timer); }
}

export function stopCommandExecutionWorkerForTests() {
  commandExecutionWorker.stopForTests();
}

