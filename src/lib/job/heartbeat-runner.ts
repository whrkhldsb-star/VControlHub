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
  const controller = new AbortController();
  const markLeaseLost = (error: unknown) => {
    if (leaseLost) return;
    leaseLost =
      error instanceof LeaseLostError ? error : new LeaseLostError(input.jobId);
    logger.warn("Lease heartbeat failed", error, { jobId: input.jobId });
    input.onHeartbeatFailure?.(leaseLost);
    // Cancel in-flight work: without this, run() would keep going until it
    // resolves on its own and only THEN see the thrown LeaseLostError, leaving
    // a window where a reclaiming worker runs the same job concurrently.
    controller.abort(leaseLost);
  };
  const timer = setInterval(() => {
    if (stopped || heartbeatInFlight || leaseLost) return;
    heartbeatInFlight = true;
    void input
      .heartbeat()
      .then((result) => {
        if (isLeaseLostResult(result)) {
          markLeaseLost(new LeaseLostError(input.jobId));
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
  }
}
