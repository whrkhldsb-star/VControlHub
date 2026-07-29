import { config } from "@/lib/config/env";
import { computeLeaseMs } from "@/lib/job/lease";
import { claimNextJob, completeJob, failJob, heartbeatJob } from "@/lib/job/service";
import { createLogger } from "@/lib/logging";

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

type CommandExecutionWorkerState = {
  started: boolean;
  running: boolean;
  timer: NodeJS.Timeout | null;
};

type CommandExecutionWorkerGlobal = typeof globalThis & {
  __vcontrolhubCommandExecutionWorker?: CommandExecutionWorkerState;
};

function getWorkerState() {
  const globalState = globalThis as CommandExecutionWorkerGlobal;
  globalState.__vcontrolhubCommandExecutionWorker ??= {
    started: false,
    running: false,
    timer: null,
  };
  return globalState.__vcontrolhubCommandExecutionWorker;
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
    await failJob(job.id, COMMAND_EXECUTION_WORKER_ID, message.slice(0, 2000));
    logger.error("Command execution job payload invalid", { jobId: job.id, error: message });
    return true;
  }

  // CommandRequest has its own heartbeat, but the durable Job lease is separate.
  // Without mid-SSH job heartbeats, claimNextJob can reclaim this RUNNING job
  // after lease expiry and start a second executeAndFinalizeCommand (duplicate SSH).
  const jobLeaseHeartbeat = setInterval(() => {
    heartbeatJob(job.id, COMMAND_EXECUTION_WORKER_ID, {
      leaseMs: COMMAND_EXECUTION_LEASE_MS,
      progress: `Executing command request ${payload.commandRequestId}`,
    }).catch((err) => {
      logger.warn("command execution job lease heartbeat failed", {
        jobId: job.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, Math.max(15_000, Math.floor(COMMAND_EXECUTION_LEASE_MS / 3)));
  jobLeaseHeartbeat.unref?.();

  try {
    await heartbeatJob(job.id, COMMAND_EXECUTION_WORKER_ID, {
      leaseMs: COMMAND_EXECUTION_LEASE_MS,
      progress: `Dispatching command request ${payload.commandRequestId}`,
    });
    const finalRequest = await executeAndFinalizeCommand(payload.commandRequestId);
    const terminalStatus = finalRequest?.status ?? null;
    // Avoid "false success": COMPLETED job must not hide a FAILED command.
    // Operation Tasks previously showed job COMPLETED even when every SSH
    // target failed — only the command row status reflected failure.
    if (terminalStatus === "FAILED" || terminalStatus === "CANCELLED") {
      await failJob(
        job.id,
        COMMAND_EXECUTION_WORKER_ID,
        `Command request ${payload.commandRequestId} ended with ${terminalStatus}`,
      );
      return true;
    }
    await completeJob(job.id, COMMAND_EXECUTION_WORKER_ID, {
      commandRequestId: payload.commandRequestId,
      status: terminalStatus,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
    await failJob(job.id, COMMAND_EXECUTION_WORKER_ID, message.slice(0, 2000));
    logger.error("Command execution job failed", {
      jobId: job.id,
      commandRequestId: payload.commandRequestId,
      error: message,
    });
    return true;
  } finally {
    clearInterval(jobLeaseHeartbeat);
  }
}

export async function runCommandExecutionJobWorkerOnce() {
  const state = getWorkerState();
  if (state.running) {
    logger.warn("Skipping command execution tick because a previous tick is still running");
    return false;
  }

  state.running = true;
  try {
    const job = await claimNextJob({
      workerId: COMMAND_EXECUTION_WORKER_ID,
      types: [COMMAND_EXECUTION_JOB_TYPE],
      leaseMs: COMMAND_EXECUTION_LEASE_MS,
    });
    if (!job) return false;
    return await handleClaimedJob(job);
  } catch (error) {
    logger.error("Command execution worker tick failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  } finally {
    state.running = false;
  }
}

export async function startCommandExecutionWorker(options: { intervalMs?: number } = {}) {
  const state = getWorkerState();
  if (state.started) return state;

  state.started = true;
  const intervalMs = options.intervalMs ?? config.worker.commandExecutionIntervalMs;

  void runCommandExecutionJobWorkerOnce().catch((error) => {
    logger.error("Command execution worker startup tick failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  state.timer = setInterval(() => {
    void runCommandExecutionJobWorkerOnce().catch((error) => {
      logger.error("Command execution worker interval tick failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, intervalMs);
  state.timer.unref?.();

  logger.info("command execution durable job worker started", {
    intervalMs,
    workerId: COMMAND_EXECUTION_WORKER_ID,
  });
  return state;
}

export function stopCommandExecutionWorkerForTests() {
  const state = getWorkerState();
  if (state.timer) {
    clearInterval(state.timer);
  }
  state.started = false;
  state.running = false;
  state.timer = null;
}

// Internal helper used by tests to peek at the live worker state without
// leaking the global symbol across module boundaries.
export function getCommandExecutionWorkerStateForTests(): CommandExecutionWorkerState {
  return getWorkerState();
}

// Internal helper used by tests / recovery scripts to verify there is no
// other in-flight worker polling the same job type on this process.
export const COMMAND_EXECUTION_INTERNAL_WORKER_ID = COMMAND_EXECUTION_WORKER_ID;
