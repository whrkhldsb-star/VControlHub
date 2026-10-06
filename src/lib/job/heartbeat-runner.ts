import { createLogger } from "@/lib/logging";

const logger = createLogger("job-heartbeat-runner");

export class LeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Job lease lost: ${jobId}`);
    this.name = "LeaseLostError";
  }
}

function isLeaseLostResult(result: unknown): boolean {
  return Boolean(
    result &&
    typeof result === "object" &&
    "count" in result &&
    Number((result as { count?: unknown }).count) === 0,
  );
}

export async function runWithLeaseHeartbeat<T>(input: {
  jobId: string;
  leaseMs: number;
  heartbeat: () => Promise<unknown>;
  /**
   * The unit of work. Receives an AbortSignal that fires the moment the lease
   * can no longer be renewed, so long in-flight operations (poll loops, remote
   * commands) can bail promptly instead of running to completion after a
   * sibling worker has already reclaimed the job. Callbacks that don't need it
   * may ignore the argument.
   */
  run: (signal: AbortSignal) => Promise<T>;
  /** Optional cancellation hook when the lease can no longer be renewed. */
  onHeartbeatFailure?: (error: unknown) => void;
}): Promise<T> {
  const intervalMs = Math.max(
    10_000,
    Math.min(5 * 60_000, Math.floor(input.leaseMs / 3)),
  );
  let stopped = false;
  let heartbeatInFlight = false;
  let leaseLost: LeaseLostError | null = null;
  let leaseDeadline = Date.now() + input.leaseMs;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const markLeaseLost = (error: unknown) => {
    if (stopped || leaseLost) return;
    leaseLost =
      error instanceof LeaseLostError ? error : new LeaseLostError(input.jobId);
    // Cancel in-flight work: without this, run() would keep going until it
    // resolves on its own and only THEN see the thrown LeaseLostError, leaving
    // a window where a reclaiming worker runs the same job concurrently.
    controller.abort(leaseLost);
    logger.warn("Lease heartbeat failed", error, { jobId: input.jobId });
    // Reporting a failure must never prevent the operation from being aborted.
    try {
      void Promise.resolve(input.onHeartbeatFailure?.(leaseLost)).catch((callbackError: unknown) => {
        logger.warn("Lease failure callback failed", callbackError, { jobId: input.jobId });
      });
    } catch (callbackError) {
      logger.warn("Lease failure callback failed", callbackError, { jobId: input.jobId });
    }
  };
  const armExpiry = () => {
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => markLeaseLost(new LeaseLostError(input.jobId)), Math.max(0, leaseDeadline - Date.now()));
    expiryTimer.unref?.();
  };
  // A pending database promise is not evidence that we still own the lease.
  // Keep an independent deadline so a hung heartbeat cannot suspend renewal
  // checks indefinitely while another process reclaims this task.
  armExpiry();
  const timer = setInterval(() => {
    if (stopped || heartbeatInFlight || leaseLost) return;
    if (Date.now() >= leaseDeadline) {
      markLeaseLost(new LeaseLostError(input.jobId));
      return;
    }
    heartbeatInFlight = true;
    const renewalStartedAt = Date.now();
    void Promise.resolve()
      .then(input.heartbeat)
      .then((result) => {
        if (stopped || leaseLost) return;
        if (isLeaseLostResult(result) || Date.now() >= leaseDeadline) {
          markLeaseLost(new LeaseLostError(input.jobId));
        } else {
          // heartbeatJob computes leaseExpiresAt when the call starts, not
          // when its database response arrives. Do not add network latency
          // to the lifetime acknowledged by the database.
          leaseDeadline = renewalStartedAt + input.leaseMs;
          armExpiry();
        }
      })
      .catch((error) => {
        markLeaseLost(error);
      })
      .finally(() => {
        heartbeatInFlight = false;
      });
  }, intervalMs);
  timer.unref?.();
  try {
    const result = await input.run(controller.signal);
    if (leaseLost) throw leaseLost;
    return result;
  } finally {
    stopped = true;
    clearInterval(timer);
    clearTimeout(expiryTimer);
  }
}
