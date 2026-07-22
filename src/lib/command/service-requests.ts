import { isProtectedByApproval } from "@/lib/auth/rbac";
import { sessionHasPermission } from "@/lib/auth/authorization";
import type { RoleKey } from "@/lib/auth/rbac";
import { teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { BusinessError, NotFoundError, ValidationError } from "@/lib/errors";
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
import { createLogger } from "@/lib/logging";
import { t } from "@/lib/i18n/translations";

const commandLogger = createLogger("command-requests");

/** Minimal session shape for multi-tenant command request scoping. */
export type CommandSessionScope = {
  userId: string;
  roles: RoleKey[];
  currentTeamId: string | null;
};

/**
 * Resolve teamId for a new CommandRequest.
 * - Explicit payload.teamId is only honoured for team:manage (admin).
 * - Otherwise stamp from session.currentTeamId via teamCreateData.
 * - System callers without session keep payload.teamId or null.
 */
function resolveCommandTeamId(
  payloadTeamId: string | null | undefined,
  session?: CommandSessionScope | null,
): string | null {
  if (session && sessionHasPermission(session, "team:manage") && payloadTeamId !== undefined) {
    return payloadTeamId;
  }
  if (session) {
    return teamCreateData(session).teamId ?? null;
  }
  return payloadTeamId ?? null;
}

/**
 * Ensure every serverId is visible under the caller's team scope (or exists
 * for unscoped system callers). Prevents command.execute IDOR onto other
 * teams' VPS after Server list/CRUD became team-scoped.
 *
 * When there is no session but a stamped teamId (playbook worker, deployment,
 * scheduled-task), still enforce that targets belong to that team or are
 * shared (teamId=null). Fully unscoped system callers keep existence-only.
 */
async function assertCommandTargetServersInScope(
  serverIds: string[],
  session?: CommandSessionScope | null,
  teamId?: string | null,
): Promise<void> {
  let scope: Record<string, unknown> = {};
  if (session) {
    scope = teamWhere(session);
  } else if (teamId) {
    // Mirror non-admin teamWhere for a concrete team stamp (no admin bypass).
    scope = { OR: [{ teamId }, { teamId: null }] };
  }
  const servers = await prisma.server.findMany({
    where: {
      id: { in: serverIds },
      ...scope,
    },
    select: { id: true },
  });
  if (servers.length !== serverIds.length) {
    throw new ValidationError(t("backend.command.targetsOutOfScope"));
  }
}

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
        ? "Pending approval"
        : request.status === "APPROVED"
          ? "Approved"
          : request.status === "REJECTED"
            ? "Rejected"
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

export async function cancelCommandRequest(input: {
  commandRequestId: string;
  actorId: string;
  reason?: string;
  session?: CommandSessionScope | null;
}) {
  const commandRequestId = input.commandRequestId.trim();
  if (!commandRequestId) {
    throw new ValidationError(t("backend.command.requestNotFound"));
  }

  const request = await prisma.commandRequest.findFirst({
    where: {
      id: commandRequestId,
      ...(input.session ? teamWhere(input.session) : {}),
    },
    include: { targets: { select: { id: true, status: true } } },
  });

  if (!request) {
    throw new NotFoundError(t("backend.command.requestNotFound"));
  }

  if (input.session) {
    const canCancelOthers =
      sessionHasPermission(input.session, "command:approve") ||
      sessionHasPermission(input.session, "team:manage");
    if (request.requesterId !== input.actorId && !canCancelOthers) {
      throw new BusinessError(t("backend.command.cannotCancelOthers"));
    }
  }

  if (!["PENDING_APPROVAL", "APPROVED", "RUNNING"].includes(request.status)) {
    throw new BusinessError(t("backend.command.cannotCancelEnded"));
  }

  const cancellableTargetIds = request.targets
    .filter((target) => ["PENDING_APPROVAL", "APPROVED", "RUNNING"].includes(target.status))
    .map((target) => target.id);
  const killedCount = cancellableTargetIds.reduce((count, targetId) => count + (cancelActiveCommandChild(targetId) ? 1 : 0), 0);
  const now = new Date();
  const reason = input.reason?.trim();
  const stderr = killedCount > 0
    ? `Command request cancelled; terminated ${killedCount} running SSH subprocesses.${reason ? ` Reason: ${reason}` : ""}`
    : `Command request cancelled.${reason ? ` Reason: ${reason}` : ""}`;

  // CAS claim first so a concurrent finalize/recovery that already moved the
  // request to COMPLETED/FAILED/CANCELLED cannot be rewritten to CANCELLED
  // (would falsify task-center history and re-open cancelled UX races).
  const claimed = await prisma.commandRequest.updateMany({
    where: {
      id: commandRequestId,
      status: { in: ["PENDING_APPROVAL", "APPROVED", "RUNNING"] },
      ...(input.session ? teamWhere(input.session) : {}),
    },
    data: { status: "CANCELLED", workerId: null, workerHeartbeatAt: null },
  });
  if (claimed.count === 0) {
    throw new BusinessError(t("backend.command.cannotCancelEnded"));
  }

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
  await prisma.executionLog.create({
    data: {
      commandRequestId,
      serverId: null,
      summary: `Command request cancelled by ${input.actorId}; ${killedCount > 0 ? `terminated ${killedCount} running SSH subprocesses.` : "no running SSH subprocesses found in the current process."}`,
    },
  });

  return prisma.commandRequest.findUniqueOrThrow({ where: { id: commandRequestId } });
}

export async function createCommandRequest(
  input: CreateCommandInput,
  session?: CommandSessionScope | null,
) {
  const payload = createCommandSchema.parse(input);
  if (payload.idempotencyKey) {
    // Scope idempotency replay by team so a shared/global key cannot return
    // another tenant's CommandRequest (and its command text / targets).
    const existing = await prisma.commandRequest.findFirst({
      where: {
        idempotencyKey: payload.idempotencyKey,
        ...(session ? teamWhere(session) : {}),
      },
      include: { targets: true },
    });
    if (existing) return { ...existing, requiresApproval: existing.status === "PENDING_APPROVAL" };
  }

  const teamId = resolveCommandTeamId(payload.teamId, session);
  // Scope servers by session teamWhere, or by stamped teamId on system paths
  // (playbook executor never has a session but always passes teamId).
  await assertCommandTargetServersInScope(payload.serverIds, session, teamId);

  const requiresApproval = isProtectedByApproval({
    actorType: toApprovalActorType(payload.submissionMode),
    actionType: "command.execute",
  });

  const status = requiresApproval ? "PENDING_APPROVAL" : "APPROVED";
  let commandRequest: Awaited<ReturnType<typeof prisma.commandRequest.create>> & {
    targets: Awaited<ReturnType<typeof prisma.commandTarget.findMany>>;
  };
  try {
    commandRequest = await prisma.commandRequest.create({
      data: {
        title: payload.title,
        command: payload.command,
        reason: payload.reason,
        requesterId: payload.requesterId,
        initiatedByType: toInitiatedByType(payload.submissionMode) as
          | "USER"
          | "ASSISTANT",
        status,
        teamId,
        idempotencyKey: payload.idempotencyKey ?? null,
        targets: {
          create: payload.serverIds.map((serverId) => ({ serverId, status })),
        },
      },
      include: { targets: true },
    });
  } catch (error) {
    // Global unique on idempotencyKey: another team may already own this key.
    // Never return foreign rows; surface a conflict instead of P2002 leak.
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (payload.idempotencyKey && (code === "P2002" || /Unique constraint/i.test(String(error)))) {
      const scopedReplay = await prisma.commandRequest.findFirst({
        where: {
          idempotencyKey: payload.idempotencyKey,
          ...(session ? teamWhere(session) : {}),
        },
        include: { targets: true },
      });
      if (scopedReplay) {
        return { ...scopedReplay, requiresApproval: scopedReplay.status === "PENDING_APPROVAL" };
      }
      throw new ValidationError(t("backend.command.idempotencyKeyInUse"));
    }
    throw error;
  }

  if (!requiresApproval) {
    await enqueueApprovedCommandExecution(
      commandRequest.id,
      t("backend.command.enqueuedFromCreate"),
    );

    // Notify requester that command execution has started; final status will be visible on the task row/logs.
    notifyCommandResult(payload.requesterId, payload.title, "approved", commandRequest.teamId).catch((err) => { commandLogger.warn("notifyCommandResult failed", { error: err instanceof Error ? err.message : String(err) }); });
  } else {
    // Notify admins about pending command approval
    notifyCommandPending(payload.requesterId, payload.title, commandRequest.teamId).catch((err) => { commandLogger.warn("notifyCommandPending failed", { error: err instanceof Error ? err.message : String(err) }); });
  }

  return { ...commandRequest, requiresApproval };
}

export async function reviewCommandRequest(
  input: ReviewCommandInput,
  session?: CommandSessionScope | null,
) {
  const payload = reviewCommandSchema.parse(input);
  const request = await prisma.commandRequest.findFirst({
    where: {
      id: payload.commandRequestId,
      ...(session ? teamWhere(session) : {}),
    },
  });

  if (!request) {
    throw new NotFoundError(t("backend.command.requestNotFound"));
  }

  if (request.status !== "PENDING_APPROVAL") {
    throw new BusinessError(t("backend.command.notPendingApproval"));
  }

  // Separation of duties: requester cannot approve/reject their own request
  // (even if they also hold command:approve). Admins with team:manage may
  // still self-review in single-operator deployments.
  if (
    request.requesterId === payload.approverId &&
    !(session && sessionHasPermission(session, "team:manage"))
  ) {
    throw new BusinessError(t("backend.command.cannotSelfReview"));
  }

  const nextStatus = payload.approved ? "APPROVED" : "REJECTED";

  // Atomic compare-and-swap: prevent concurrent approvers from double-executing
  await prisma.$transaction(async (tx) => {
    await tx.commandApproval.create({
      data: {
        commandRequestId: payload.commandRequestId,
        approverId: payload.approverId,
        approved: payload.approved,
        comment: payload.comment,
      },
    });

    const claimed = await tx.commandRequest.updateMany({
      where: {
        id: payload.commandRequestId,
        status: "PENDING_APPROVAL",
        ...(session ? teamWhere(session) : {}),
      },
      data: payload.approved
        ? { status: nextStatus }
        : { status: nextStatus, workerId: null, workerHeartbeatAt: null },
    });

    if (claimed.count === 0) {
      throw new BusinessError(t("backend.command.alreadyReviewed"));
    }
  });

  if (payload.approved) {
    // Notify requester: command approved
    notifyCommandResult(request.requesterId, request.title, "approved", request.teamId).catch((err) => { commandLogger.warn("notifyCommandResult failed", { error: err instanceof Error ? err.message : String(err) }); });

    await enqueueApprovedCommandExecution(
      payload.commandRequestId,
      t("backend.command.enqueuedFromApproval"),
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
      summary: t("backend.command.rejectedSummary"),
    },
  });

  // Notify requester: command rejected
  notifyCommandResult(request.requesterId, request.title, "rejected", request.teamId).catch((err) => { commandLogger.warn("notifyCommandResult failed", { error: err instanceof Error ? err.message : String(err) }); });

  return request;
}

export async function listCommandRequests(session?: CommandSessionScope | null) {
  const where = session ? { ...teamWhere(session) } : {};
  const requests = await prisma.commandRequest.findMany({
    where,
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
