import { isProtectedByApproval } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import {
  notifyCommandPending,
  notifyCommandResult,
} from "@/lib/notification/service";
import {
  createCommandSchema,
  reviewCommandSchema,
  type CreateCommandInput,
  type ReviewCommandInput,
} from "./schema";
import { cancelActiveCommandChild, enqueueApprovedCommandExecution } from "./service-execution";

function toApprovalActorType(submissionMode: "user" | "assistant") {
  return submissionMode;
}

function toInitiatedByType(submissionMode: "user" | "assistant") {
  return submissionMode === "assistant" ? "ASSISTANT" : "USER";
}

function mapCommandRequest(
  request: Awaited<
    ReturnType<typeof prisma.commandRequest.findMany>
  >[number] & {
    requester: { id: string; username: string; displayName: string | null };
    approvals: Array<Record<string, unknown>>;
    targets: Array<Record<string, unknown>>;
    executionLogs: Array<Record<string, unknown>>;
  },
) {
  return {
    id: request.id,
    title: request.title,
    command: request.command,
    reason: request.reason,
    status: request.status,
    initiatedByType: request.initiatedByType,
    requesterId: request.requesterId,
    createdAt: request.createdAt?.toISOString?.() ?? request.createdAt,
    updatedAt: request.updatedAt?.toISOString?.() ?? request.updatedAt,
    requester: request.requester,
    approvals: request.approvals.map(
      (
        a: Record<string, unknown> & {
          createdAt?: Date | string;
          approved?: boolean;
          approver?: {
            id: string;
            username: string;
            displayName: string | null;
          };
          comment?: string | null;
        },
      ) => ({
        approved: a.approved as boolean,
        approver: a.approver as {
          id: string;
          username: string;
          displayName: string | null;
        },
        comment: (a.comment as string | null) ?? null,
        createdAt:
          a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt,
      }),
    ),
    targets: request.targets.map(
      (
        t: Record<string, unknown> & {
          finishedAt?: Date | string;
          createdAt?: Date | string;
          updatedAt?: Date | string;
          id?: string;
          status?: string;
          server?: { id: string; name: string; host: string; port: number };
        },
      ) => ({
        id: t.id as string,
        status: t.status as string,
        server: t.server as {
          id: string;
          name: string;
          host: string;
          port: number;
        },
        finishedAt:
          t.finishedAt instanceof Date
            ? t.finishedAt.toISOString()
            : t.finishedAt,
        createdAt:
          t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
        updatedAt:
          t.updatedAt instanceof Date ? t.updatedAt.toISOString() : t.updatedAt,
      }),
    ),
    executionLogs: request.executionLogs.map(
      (
        log: Record<string, unknown> & {
          id?: string;
          createdAt?: Date | string;
          summary?: string;
          exitCode?: number | null;
          stdout?: string | null;
          stderr?: string | null;
        },
      ) => ({
        id: log.id as string | undefined,
        summary: (log.summary as string) ?? "",
        exitCode: (log.exitCode as number | null) ?? null,
        stdout: (log.stdout as string | null) ?? null,
        stderr: (log.stderr as string | null) ?? null,
        createdAt:
          log.createdAt instanceof Date
            ? log.createdAt.toISOString()
            : log.createdAt,
      }),
    ),
    approvalStateLabel:
      request.status === "PENDING_APPROVAL"
        ? "待审批"
        : request.status === "APPROVED"
          ? "已批准"
          : request.status === "REJECTED"
            ? "已拒绝"
            : request.status,
    targetSummary: request.targets.map(
      (
        target: Record<string, unknown> & {
          server?: { name: string };
          status?: string;
        },
      ) => `${(target.server as { name: string })?.name} · ${target.status}`,
    ),
    latestApproval: request.approvals[0]
      ? {
          approved: request.approvals[0].approved as boolean,
          approver: request.approvals[0].approver as {
            id: string;
            username: string;
            displayName: string | null;
          },
          comment: (request.approvals[0].comment as string | null) ?? null,
          createdAt:
            request.approvals[0].createdAt instanceof Date
              ? request.approvals[0].createdAt.toISOString()
              : request.approvals[0].createdAt,
        }
      : null,
    latestLog: request.executionLogs[0]
      ? {
          id: request.executionLogs[0].id as string | undefined,
          summary: (request.executionLogs[0].summary as string) ?? "",
          exitCode:
            (request.executionLogs[0].exitCode as number | null) ?? null,
          stdout: (request.executionLogs[0].stdout as string | null) ?? null,
          stderr: (request.executionLogs[0].stderr as string | null) ?? null,
          createdAt:
            request.executionLogs[0].createdAt instanceof Date
              ? request.executionLogs[0].createdAt.toISOString()
              : request.executionLogs[0].createdAt,
        }
      : null,
    isAssistantInitiated: request.initiatedByType === "ASSISTANT",
  };
}

export async function cancelCommandRequest(input: { commandRequestId: string; actorId: string; reason?: string }) {
  const commandRequestId = input.commandRequestId.trim();
  if (!commandRequestId) {
    throw new Error("命令请求不存在");
  }

  const request = await prisma.commandRequest.findUnique({
    where: { id: commandRequestId },
    include: { targets: { select: { id: true, status: true } } },
  });

  if (!request) {
    throw new Error("命令请求不存在");
  }

  if (!["PENDING_APPROVAL", "APPROVED", "RUNNING"].includes(request.status)) {
    throw new Error("当前命令请求已结束，无法取消");
  }

  const cancellableTargetIds = request.targets
    .filter((target) => ["PENDING_APPROVAL", "APPROVED", "RUNNING"].includes(target.status))
    .map((target) => target.id);
  const killedCount = cancellableTargetIds.reduce((count, targetId) => count + (cancelActiveCommandChild(targetId) ? 1 : 0), 0);
  const now = new Date();
  const reason = input.reason?.trim();
  const stderr = killedCount > 0
    ? `命令请求已取消；已终止 ${killedCount} 个正在运行的 SSH 子进程。${reason ? `原因：${reason}` : ""}`
    : `命令请求已取消。${reason ? `原因：${reason}` : ""}`;

  await prisma.commandTarget.updateMany({
    where: {
      commandRequestId,
      status: { in: ["PENDING_APPROVAL", "APPROVED", "RUNNING"] },
    },
    data: {
      status: "CANCELLED",
      stderr,
      exitCode: 130,
      finishedAt: now,
    },
  });
  await prisma.commandRequest.update({
    where: { id: commandRequestId },
    data: { status: "CANCELLED", workerId: null, workerHeartbeatAt: null },
  });
  await prisma.executionLog.create({
    data: {
      commandRequestId,
      serverId: null,
      summary: `命令请求已由 ${input.actorId} 取消；${killedCount > 0 ? `已终止 ${killedCount} 个运行中的 SSH 子进程。` : "没有发现当前进程内仍在运行的 SSH 子进程。"}`,
    },
  });

  return prisma.commandRequest.findUniqueOrThrow({ where: { id: commandRequestId } });
}

export async function createCommandRequest(input: CreateCommandInput) {
  const payload = createCommandSchema.parse(input);
  const requiresApproval = isProtectedByApproval({
    actorType: toApprovalActorType(payload.submissionMode),
    actionType: "command.execute",
  });

  const status = requiresApproval ? "PENDING_APPROVAL" : "APPROVED";
  const commandRequest = await prisma.commandRequest.create({
    data: {
      title: payload.title,
      command: payload.command,
      reason: payload.reason,
      requesterId: payload.requesterId,
      initiatedByType: toInitiatedByType(payload.submissionMode) as
        | "USER"
        | "ASSISTANT",
      status,
      targets: {
        create: payload.serverIds.map((serverId) => ({ serverId, status })),
      },
    },
    include: { targets: true },
  });

  if (!requiresApproval) {
    await enqueueApprovedCommandExecution(
      commandRequest.id,
      "站内用户操作已进入后台 SSH 执行队列，可在任务中心查看各节点状态。",
    );

    // Notify requester that command execution has started; final status will be visible on the task row/logs.
    notifyCommandResult(payload.requesterId, payload.title, "approved").catch(
      () => {},
    );
  } else {
    // Notify admins about pending command approval
    notifyCommandPending(payload.requesterId, payload.title).catch(() => {});
  }

  return { ...commandRequest, requiresApproval };
}

export async function reviewCommandRequest(input: ReviewCommandInput) {
  const payload = reviewCommandSchema.parse(input);
  const request = await prisma.commandRequest.findUnique({
    where: { id: payload.commandRequestId },
  });

  if (!request) {
    throw new Error("命令请求不存在");
  }

  if (request.status !== "PENDING_APPROVAL") {
    throw new Error("当前命令请求不在待审批状态");
  }

  const nextStatus = payload.approved ? "APPROVED" : "REJECTED";

  await prisma.commandApproval.create({
    data: {
      commandRequestId: payload.commandRequestId,
      approverId: payload.approverId,
      approved: payload.approved,
      comment: payload.comment,
    },
  });

  const updated = await prisma.commandRequest.update({
    where: { id: payload.commandRequestId },
    data: payload.approved
      ? { status: nextStatus }
      : { status: nextStatus, workerId: null, workerHeartbeatAt: null },
  });

  if (payload.approved) {
    // Notify requester: command approved
    notifyCommandResult(request.requesterId, request.title, "approved").catch(
      () => {},
    );

    await enqueueApprovedCommandExecution(
      payload.commandRequestId,
      "命令审批已通过，任务已进入后台 SSH 执行队列。",
    );

    return prisma.commandRequest.findUniqueOrThrow({
      where: { id: payload.commandRequestId },
    });
  }

  await prisma.commandTarget.updateMany({
    where: { commandRequestId: payload.commandRequestId },
    data: {
      status: "REJECTED",
      finishedAt: new Date(),
    },
  });

  await prisma.executionLog.create({
    data: {
      commandRequestId: payload.commandRequestId,
      serverId: null,
      summary: "命令审批已拒绝，任务不会进入执行队列。",
    },
  });

  // Notify requester: command rejected
  notifyCommandResult(request.requesterId, request.title, "rejected").catch(
    () => {},
  );

  return updated;
}

export async function listCommandRequests() {
  const requests = await prisma.commandRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      requester: { select: { id: true, username: true, displayName: true } },
      approvals: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          approver: { select: { id: true, username: true, displayName: true } },
        },
      },
      targets: {
        take: 50,
        include: {
          server: { select: { id: true, name: true, host: true, port: true } },
        },
      },
      executionLogs: { orderBy: { createdAt: "desc" }, take: 3 },
    },
  });

  return requests.map(mapCommandRequest);
}
