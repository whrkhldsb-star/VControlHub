import { prisma } from "@/lib/db";
import {
  COMMAND_WORKER_ID,
  enqueueApprovedCommandExecution,
  getCommandRuntimeConfigValues,
} from "./service-execution";

// TR-040: bound the per-request recovery fan-out so a 50-stale-request sweep
// can process multiple requests in parallel without saturating the Prisma
// connection pool (default poolSize=10). 5 keeps the per-call load at ~15
// concurrent ops (3 per request) which is well within headroom.
const RECOVER_STALE_CONCURRENCY = 5;

type StaleRequest = {
  id: string;
  workerId: string | null;
  workerHeartbeatAt: Date | null;
  targets: Array<{ id: string; status: string }>;
};

export async function recoverStaleRunningCommandRequests(now = new Date()) {
  const runtimeConfig = await getCommandRuntimeConfigValues();
  const staleCutoff = new Date(now.getTime() - runtimeConfig.staleRunningAfterMs);
  const staleRequests = await prisma.commandRequest.findMany({
    where: {
      status: "RUNNING",
      OR: [
        { workerHeartbeatAt: { lt: staleCutoff } },
        { workerHeartbeatAt: null, updatedAt: { lt: staleCutoff } },
      ],
    },
    select: {
      id: true,
      workerId: true,
      workerHeartbeatAt: true,
      targets: { select: { id: true, status: true } },
    },
    take: 50,
  });

  let recovered = 0;
  // Process stale requests in bounded-concurrency chunks. Each request's
  // own 3 writes (updateMany targets + update request + create log) stay
  // sequential because they all share the same request id, but different
  // requests fan out in parallel to remove the O(N) sequential round-trip
  // cost that previously dominated the recovery sweep.
  for (let i = 0; i < staleRequests.length; i += RECOVER_STALE_CONCURRENCY) {
    const chunk = staleRequests.slice(i, i + RECOVER_STALE_CONCURRENCY);
    const outcomes = await Promise.all(chunk.map((request) => recoverOne(request, now)));
    for (const ok of outcomes) if (ok) recovered += 1;
  }

  return { recovered };
}

async function recoverOne(request: StaleRequest, now: Date): Promise<boolean> {
  const targetStatuses = request.targets.map((target) => target.status);
  const hasRunningOrQueuedTarget = targetStatuses.some((status) => ["RUNNING", "APPROVED", "PENDING_APPROVAL"].includes(status));
  if (hasRunningOrQueuedTarget) {
    await prisma.commandTarget.updateMany({
      where: {
        commandRequestId: request.id,
        status: { in: ["RUNNING", "APPROVED", "PENDING_APPROVAL"] },
      },
      data: {
        status: "FAILED",
        stderr: "The background SSH executor may have been interrupted by a service restart or process exit; it has been automatically marked as failed. Please resubmit or retry.",
        exitCode: 255,
        finishedAt: now,
      },
    });
    await prisma.commandRequest.update({
      where: { id: request.id },
      data: { status: "FAILED", workerId: null, workerHeartbeatAt: null },
    });
    const heartbeatDetail = request.workerHeartbeatAt
      ? `, last heartbeat ${request.workerHeartbeatAt.toISOString()}`
      : ", no worker heartbeat record";
    await prisma.executionLog.create({
      data: {
        commandRequestId: request.id,
        serverId: null,
        summary: `Stale RUNNING command detected: background executor ${request.workerId ?? "unknown"}${heartbeatDetail}, likely lost during service restart; automatically recovered to FAILED to avoid the task center being stuck long-term.`,
      },
    });
    return true;
  }

  const allCompleted = targetStatuses.length > 0 && targetStatuses.every((status) => status === "COMPLETED");
  const nextStatus = allCompleted ? "COMPLETED" : "FAILED";
  await prisma.commandRequest.update({
    where: { id: request.id },
    data: { status: nextStatus, workerId: null, workerHeartbeatAt: null },
  });
  const archiveHeartbeatDetail = request.workerHeartbeatAt
    ? `, last heartbeat ${request.workerHeartbeatAt.toISOString()}`
    : ", no worker heartbeat record";
  await prisma.executionLog.create({
    data: {
      commandRequestId: request.id,
      serverId: null,
      summary: `Stale RUNNING command detected: background executor ${request.workerId ?? "unknown"}${archiveHeartbeatDetail}; automatically archived as ${nextStatus} based on target status.`,
    },
  });
  return true;
}

// TR-040: bound the approved-claim fan-out so a 20-request sweep enqueues
// in chunks instead of one transaction at a time.
const RECOVER_QUEUED_CONCURRENCY = 5;

export async function recoverQueuedApprovedCommandRequests(limit = 20) {
  const queuedRequests = await prisma.commandRequest.findMany({
    where: { status: "APPROVED" },
    orderBy: { updatedAt: "asc" },
    select: { id: true },
    take: limit,
  });

  let enqueued = 0;
  // Each enqueue runs in its own short transaction; the enqueues are
  // independent, so run them in bounded-concurrency chunks to collapse
  // the previous O(N) sequential round-trips into O(N/CONCURRENCY).
  for (let i = 0; i < queuedRequests.length; i += RECOVER_QUEUED_CONCURRENCY) {
    const chunk = queuedRequests.slice(i, i + RECOVER_QUEUED_CONCURRENCY);
    const outcomes = await Promise.all(
      chunk.map((request) =>
        enqueueApprovedCommandExecution(
          request.id,
          `Approved but not-yet-running command detected: maintenance worker ${COMMAND_WORKER_ID} has re-claimed it and placed it in the background SSH execution queue.`,
        ),
      ),
    );
    for (const claimed of outcomes) if (claimed) enqueued += 1;
  }

  return { enqueued };
}
