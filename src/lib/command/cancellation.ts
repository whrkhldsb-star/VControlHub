import { prisma } from "@/lib/db";

/** A durable cancellation request is visible to every worker process. */
export async function monitorCommandCancellation(targetId: string, controller: AbortController) {
  let stopped = false;
  let checking = false;
  const check = async () => {
    if (stopped || checking || controller.signal.aborted) return;
    checking = true;
    let deadlineTimer: NodeJS.Timeout | undefined;
    try {
      const target = await Promise.race([prisma.commandTarget.findUnique({
        where: { id: targetId },
        select: { status: true, commandRequest: { select: { status: true } } },
      }), new Promise<never>((_resolve, reject) => { deadlineTimer = setTimeout(() => reject(new Error("Cancellation lookup deadline exceeded")), 5_000); })]);
      if (!stopped && (!target || ["CANCELLING", "CANCELLED", "FAILED", "REJECTED"].includes(target.status)
        || ["CANCELLING", "CANCELLED", "FAILED", "REJECTED"].includes(target.commandRequest.status))) {
        controller.abort(new Error("Command execution was cancelled or revoked"));
      }
    } catch {
      // Losing the control plane must not leave an ungoverned execution alive.
      if (!stopped) controller.abort(new Error("Cannot verify command cancellation state"));
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
