import { prisma } from "@/lib/db";

/**
 * The reason a command is stopped when its cancellation state could not be
 * read. Nobody asked for that stop, and the executor reports it as such: with
 * a plain Error it was recorded as "cancelled by the operator".
 */
export class CommandCancellationStateUnknownError extends Error {
  constructor() {
    super("Cannot verify command cancellation state");
    this.name = "CommandCancellationStateUnknownError";
  }
}

/**
 * Lookups that fail in a row before an execution is stopped. One failed or slow lookup (a lock wait, a failover)
 * used to stop every running command at once while the remote processes kept going; a control plane that stays
 * unreachable for three checks still stops them.
 */
export const CANCELLATION_LOOKUP_FAILURE_LIMIT = 3;

/** A durable cancellation request is visible to every worker process. */
export async function monitorCommandCancellation(targetId: string, controller: AbortController) {
  let stopped = false;
  let checking = false;
  let failures = 0;
  const check = async () => {
    if (stopped || checking || controller.signal.aborted) return;
    checking = true;
    let deadlineTimer: NodeJS.Timeout | undefined;
    try {
      const target = await Promise.race([prisma.commandTarget.findUnique({
        where: { id: targetId },
        select: { status: true, commandRequest: { select: { status: true } } },
      }), new Promise<never>((_resolve, reject) => { deadlineTimer = setTimeout(() => reject(new Error("Cancellation lookup deadline exceeded")), 5_000); })]);
      failures = 0;
      if (!stopped && (!target || ["CANCELLING", "CANCELLED", "FAILED", "REJECTED"].includes(target.status)
        || ["CANCELLING", "CANCELLED", "FAILED", "REJECTED"].includes(target.commandRequest.status))) {
        controller.abort(new Error("Command execution was cancelled or revoked"));
      }
    } catch {
      // Losing the control plane must not leave an ungoverned execution alive.
      failures += 1;
      if (!stopped && failures >= CANCELLATION_LOOKUP_FAILURE_LIMIT) controller.abort(new CommandCancellationStateUnknownError());
    } finally {
      clearTimeout(deadlineTimer);
      checking = false;
    }
  };
  await check();
  const timer = setInterval(() => { void check(); }, 1_000);
  timer.unref?.();
  return () => { stopped = true; clearInterval(timer); };
}
