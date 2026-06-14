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
        stderr: "后台 SSH 执行器可能因服务重启或进程退出而中断；已自动标记为失败，请重新提交或重试。",
        exitCode: 255,
        finishedAt: now,
      },
    });
    await prisma.commandRequest.update({
      where: { id: request.id },
      data: { status: "FAILED", workerId: null, workerHeartbeatAt: null },
    });
    const heartbeatDetail = request.workerHeartbeatAt
      ? `，最后心跳 ${request.workerHeartbeatAt.toISOString()}`
      : "，无 worker 心跳记录";
    await prisma.executionLog.create({
      data: {
        commandRequestId: request.id,
        serverId: null,
        summary: `检测到陈旧 RUNNING 命令：后台执行器 ${request.workerId ?? "未知"}${heartbeatDetail}，可能已随服务重启丢失；已自动恢复为 FAILED，避免任务中心长期卡住。`,
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
    ? `，最后心跳 ${request.workerHeartbeatAt.toISOString()}`
    : "，无 worker 心跳记录";
  await prisma.executionLog.create({
    data: {
      commandRequestId: request.id,
      serverId: null,
      summary: `检测到陈旧 RUNNING 命令：后台执行器 ${request.workerId ?? "未知"}${archiveHeartbeatDetail}；已根据目标状态自动归档为 ${nextStatus}。`,
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
          `检测到已批准但尚未进入运行态的命令：维护 worker ${COMMAND_WORKER_ID} 已重新认领并放入后台 SSH 执行队列。`,
        ),
      ),
    );
    for (const claimed of outcomes) if (claimed) enqueued += 1;
  }

  return { enqueued };
}
