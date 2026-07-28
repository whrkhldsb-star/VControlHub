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
  run: () => Promise<T>;
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
  const markLeaseLost = (error: unknown) => {
    if (leaseLost) return;
    leaseLost =
      error instanceof LeaseLostError ? error : new LeaseLostError(input.jobId);
    logger.warn("Lease heartbeat failed", error, { jobId: input.jobId });
    input.onHeartbeatFailure?.(leaseLost);
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
    const result = await input.run();
    if (leaseLost) throw leaseLost;
    return result;
  } finally {
    stopped = true;
    clearInterval(timer);
  }
}
