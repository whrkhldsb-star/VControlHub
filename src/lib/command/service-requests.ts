import { createdBeforeCursor } from "@/lib/http/page-cursor";
import { createHash } from "node:crypto";
import type { CommandOrigin, CommandRequestStatus, Prisma } from "@prisma/client";
import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { sessionHasPermission } from "@/lib/auth/authorization";
import type { RoleKey } from "@/lib/auth/rbac";
import { commandRequestTeamWhere, serverTeamWhere, teamCreateData } from "@/lib/auth/team-scope";
import { prisma, isUniqueViolation } from "@/lib/db";
import { BusinessError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
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
import { mayReviewCommandRequest, maySelfReviewCommands } from "./review-scope";
import { canReadCommandBody, RECENT_COMMAND_LOG_LIMIT, withVisibleCommandLogs } from "./visibility";
import { createLogger } from "@/lib/logging";
import { t } from "@/lib/i18n/service-translations";
import { OPERATION_TARGET_SELECT, operationTargetAvailability } from "@/lib/server/availability";
import {
  decideCommandApproval,
  inferCommandOrigin,
  isAiCommandOrigin,
  type CommandDecisionSource,
} from "./approval-policy";
import { getApprovalPolicySettings } from "./approval-policy-settings";
import { classifyCommandRiskForTargets, type CommandRiskLevel } from "./risk-classifier";
import { maskCommandOutput } from "./output-masker";
import { COMMAND_DETAIL_OUTPUT_TAIL_CHARS, fetchTargetOutputTails } from "./target-output";

import { approvalEndpointSelect, approvalReceiptId, manualRunInitiator, manualRunKeyPrefix, manualRunPrefix } from "./approval-identity";

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
 * scheduled-task), still enforce that targets belong to that team. Legacy
 * null-team server roots are quarantined rather than treated as shared.
 */
async function assertCommandTargetServersInScope(
  serverIds: string[],
  session?: CommandSessionScope | null,
  teamId?: string | null,
): Promise<Array<{ id: string; operatingSystem: string }>> {
  let scope: Record<string, unknown>;
  if (session) {
    scope = serverTeamWhere(session, "connect");
  } else if (teamId) {
    // Concrete worker stamp has no admin bypass and must use strict server scope.
    scope = { teamId };
  } else {
    // No session AND no concrete teamId (e.g. a null-team playbook run reaching
    // the executor with teamId=null). Servers are security roots: a null-team
    // caller may ONLY target quarantined null-team servers, never fall through
    // to an unfiltered scope that would allow cross-team command execution.
    // This mirrors serverTeamWhere's "null teamId is quarantine, not shared".
    scope = { teamId: null };
  }
  const servers = await prisma.server.findMany({
    where: {
      id: { in: serverIds },
      ...scope,
    },
    select: {
      id: true,
      enabled: true,
      ...OPERATION_TARGET_SELECT,
    },
  });
  if (servers.length !== serverIds.length) {
    throw new ValidationError(t("backend.command.targetsOutOfScope"));
  }
  if (servers.some((server) => server.enabled === false)) {
    throw new ValidationError(t("backend.command.targetsDisabled"));
  }
  if (servers.some((server) => !operationTargetAvailability(server).available)) {
    throw new ValidationError(t("backend.command.targetsUnavailable"));
  }
  return servers.map((server) => ({
    id: server.id,
    operatingSystem: typeof server.operatingSystem === "string" && server.operatingSystem ? server.operatingSystem : "LINUX",
  }));
}

function toInitiatedByType(submissionMode: "user" | "assistant") {
  return submissionMode === "assistant" ? "ASSISTANT" : "USER";
}

function deriveCommandOrigin(input: {
  source?: "api";
  explicitOrigin?: CommandOrigin;
  viaToken?: boolean;
  storedKey?: string;
  submissionMode: "user" | "assistant";
}): CommandOrigin {
  // Public API requests may NEVER choose AI/DEPLOYMENT/PLAYBOOK origins.
  if (input.source === "api") {
    return input.viaToken ? "API" : "USER_UI";
  }
  if (input.explicitOrigin) {
    return input.explicitOrigin;
  }
  const key = input.storedKey ?? "";
  if (key.startsWith("deployment-rollback:")) return "DEPLOYMENT_ROLLBACK";
  if (key.startsWith("deployment:")) return "DEPLOYMENT";
  if (key.startsWith("ai-hosted-action:")) return "AI_CHAT";
  if (key.startsWith("ai-automation:")) return "AI_AUTOMATION";
  if (key.startsWith("scheduled-task:")) return "SCHEDULED_TASK";
  if (key.startsWith("playbook:")) return "PLAYBOOK";
  return input.submissionMode === "assistant" ? "AI_CHAT" : "USER_UI";
}

function mapCommandRequest(
  request: Awaited<
    ReturnType<typeof prisma.commandRequest.findMany>
  >[number] & {
    _count: { targets: number };
    requester: { id: string; username: string; displayName: string | null };
    scheduledTaskRuns: { manual: boolean }[];
    approvals: Array<Record<string, unknown>>;
    targets: Array<Record<string, unknown>>;
    executionLogs: Array<Record<string, unknown>>;
  },
) {
  const targets = request.targets.map((target) => {
    const server = target.server as { id: string; name: string; host: string; port: number; teamId: string | null } | undefined;
    const visible = server && server.teamId === request.teamId;
    return {
      id: target.id as string,
      status: target.status as string,
      executionChannel: (target.executionChannel as string | null) ?? null,
      fallbackReason: (target.fallbackReason as string | null) ?? null,
      outcomeUnknown: target.outcomeUnknown === true,
      server: visible ? { id: server.id, name: server.name, host: server.host, port: server.port } : null,
      finishedAt: target.finishedAt instanceof Date ? target.finishedAt.toISOString() : target.finishedAt as string | undefined,
      createdAt: target.createdAt instanceof Date ? target.createdAt.toISOString() : target.createdAt as string | undefined,
      updatedAt: target.updatedAt instanceof Date ? target.updatedAt.toISOString() : target.updatedAt as string | undefined,
    };
  });
  const logs = request.executionLogs;
  const runInitiatorId = manualRunInitiator(request.idempotencyKey);
  const origin = inferCommandOrigin(request);
  const riskReasons = Array.isArray(request.riskReasons)
    ? request.riskReasons.filter((reason): reason is string => typeof reason === "string")
    : [];
  return {
    id: request.id,
    title: request.title,
    command: request.command,
    reason: request.reason,
    status: request.status,
    initiatedByType: request.initiatedByType,
    origin,
    riskLevel: (request.riskLevel as CommandRiskLevel | null) ?? null,
    riskReasons,
    decisionSource: request.decisionSource ?? null,
    requesterId: request.requesterId,
    runInitiatorId,
    unattributedManualRun: !runInitiatorId && Boolean(request.scheduledTaskRuns?.length),
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
    targets,
    targetCount: request._count.targets,
    executionLogs: logs.map(
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
        ? t("backend.command.approvalState.pending")
        : request.status === "APPROVED"
          ? t("backend.command.approvalState.approved")
          : request.status === "REJECTED"
            ? t("backend.command.approvalState.rejected")
            : request.status,
    targetSummary: targets.map((target) => `${target.server?.name ?? target.id} · ${target.status}`),
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
    latestLog: logs[0]
      ? {
          id: logs[0].id as string | undefined,
          summary: (logs[0].summary as string) ?? "",
          exitCode:
            (logs[0].exitCode as number | null) ?? null,
          stdout: (logs[0].stdout as string | null) ?? null,
          stderr: (logs[0].stderr as string | null) ?? null,
          createdAt:
            logs[0].createdAt instanceof Date
              ? logs[0].createdAt.toISOString()
              : logs[0].createdAt,
        }
      : null,
    isAssistantInitiated: isAiCommandOrigin(origin),
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
      // Quarantine null-team requests: a team user must not cancel another
      // team's (or unassigned legacy) request. Only global managers see all.
      ...(input.session ? commandRequestTeamWhere(input.session) : {}),
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
    // A member who may submit but not execute commands could not take back a request nobody had approved yet:
    // they may withdraw their own while it waits; stopping one that runs stays with those who execute.
    if (!sessionHasPermission(input.session, "command:execute")
      && !(request.requesterId === input.actorId && request.status === "PENDING_APPROVAL")) {
      throw new BusinessError(t("backend.command.withdrawOnlyPending"));
    }
  }

  if (request.status === "CANCELLING") return { id: request.id, status: request.status };
  if (!["PENDING_APPROVAL", "APPROVED", "RUNNING"].includes(request.status)) {
    throw new BusinessError(t("backend.command.cannotCancelEnded"));
  }

  const cancellableTargetIds = request.targets
    .filter((target) => ["PENDING_APPROVAL", "APPROVED", "RUNNING"].includes(target.status))
    .map((target) => target.id);
  const now = new Date();
  const reason = input.reason?.trim();

  const stderr = `Command cancellation requested.${reason ? ` Reason: ${reason}` : ""}`;
  await prisma.$transaction(async tx => {
    // CAS claim FIRST so a concurrent finalize/recovery that already moved the
    // request to COMPLETED/FAILED/CANCELLED does not get SIGTERM while history
    // stays terminal (kill only after we own the cancel transition).
    const claimed = await tx.commandRequest.updateMany({
      where: {
        id: commandRequestId,
        status: request.status,
        ...(input.session ? commandRequestTeamWhere(input.session) : {}),
      },
      data: request.status === "RUNNING"
        ? { status: "CANCELLING" }
        : { status: "CANCELLED", workerId: null, workerHeartbeatAt: null },
    });
    if (claimed.count === 0) {
      throw new BusinessError(t("backend.command.cannotCancelEnded"));
    }

    await tx.commandTarget.updateMany({
      where: {
        commandRequestId,
        status: { in: ["PENDING_APPROVAL", "APPROVED"] },
      },
      data: {
        status: "CANCELLED",
        stderr,
        exitCode: 130,
        finishedAt: now,
      },
    });
    if (request.status === "RUNNING") {
      await tx.commandTarget.updateMany({
        where: { commandRequestId, status: "RUNNING" },
        data: { status: "CANCELLING", stderr },
      });
    } else {
      // Older enqueue failures could restore APPROVED on the parent while
      // leaving a target RUNNING. Its transport outcome cannot be confirmed.
      await tx.commandTarget.updateMany({
        where: { commandRequestId, status: { in: ["RUNNING", "CANCELLING"] } },
        data: { status: "FAILED", outcomeUnknown: true, stderr, exitCode: 255, finishedAt: now },
      });
    }
  });
  const killedCount = cancellableTargetIds.reduce(
    (count, targetId) => count + (cancelActiveCommandChild(targetId) ? 1 : 0),
    0,
  );
  await prisma.executionLog.create({
    data: {
      commandRequestId,
      serverId: null,
      summary: `Command cancellation requested by ${input.actorId}; signalled ${killedCount} local transports; awaiting executor acknowledgement for running targets.`,
    },
  });

  const updated = await prisma.commandRequest.findUniqueOrThrow({ where: { id: commandRequestId }, select: { id: true, status: true } });
  if (updated.status === "CANCELLED") {
    await import("@/lib/ai/hosted-outcome")
      .then(({ projectCommandOutcomeToHostedAction }) => projectCommandOutcomeToHostedAction(commandRequestId))
      .catch(() => undefined);
  }
  return updated;
}

// Older public submissions had no provenance column. A collision with any
// internal producer's prefix cannot safely identify a public receipt.
const RESERVED_COMMAND_KEY = /^(?:api|playbook|scheduled-task|deployment(?:-rollback)?|ai-hosted-action|ai-automation):/;
const SUBMISSION_TARGET_SELECT = { id: true, serverId: true, status: true } as const;

export type CreateCommandInternalOptions = {
  origin?: CommandOrigin;
  decisionSource?: CommandDecisionSource;
  /** Record an explicit human approval + endpoint receipts atomically on creation (AI inline self-review or cross-user approve). */
  approveOnCreate?: {
    approverId: string;
    decisionSource: "SELF_REVIEW" | "REVIEWER" | "REQUESTER_CONFIRMED";
    comment?: string;
  };
  viaToken?: boolean;
  /** Explicit caller `command:execute` status for session-less internal callers (e.g. deployments/rollbacks). */
  submitterMayExecute?: boolean;
};

export async function previewCommandSubmission(
  input: {
    command: string;
    serverIds?: string[];
    approvalRequired?: boolean;
    viaToken?: boolean;
  },
  session: CommandSessionScope,
) {
  const teamId = resolveCommandTeamId(undefined, session);
  const serverIds = Array.from(new Set((input.serverIds ?? []).map((id) => id.trim()).filter(Boolean)));
  const targets = serverIds.length > 0
    ? await assertCommandTargetServersInScope(serverIds, session, teamId)
    : [];
  const assessment = classifyCommandRiskForTargets(
    input.command,
    targets.map((target) => target.operatingSystem),
  );
  const policies = await getApprovalPolicySettings();
  const origin: CommandOrigin = input.viaToken ? "API" : "USER_UI";
  const submitterMayExecute = sessionHasPermission(session, "command:execute");
  const decision = decideCommandApproval({
    policies,
    origin,
    riskLevel: assessment.level,
    denylisted: assessment.denylisted,
    submitterMayExecute,
    requestedReview: input.approvalRequired === true,
  });
  const directCheck = decideCommandApproval({
    policies,
    origin,
    riskLevel: assessment.level,
    denylisted: assessment.denylisted,
    submitterMayExecute,
    requestedReview: false,
  });
  return {
    origin,
    riskLevel: assessment.level,
    riskReasons: assessment.reasons,
    denylisted: assessment.denylisted,
    sensitivePath: assessment.sensitivePath,
    classifierVersion: assessment.version,
    requiresApproval: decision.requiresApproval,
    reason: decision.reason,
    effectivePolicy: decision.effectivePolicy,
    canBypassApproval: !directCheck.requiresApproval,
    submitterMayExecute,
  };
}

export async function createCommandRequest(
  input: CreateCommandInput,
  session?: CommandSessionScope | null,
  source?: "api",
  recordCreation?: (tx: Prisma.TransactionClient, commandRequestId: string) => Promise<void>,
  internalOptions?: CreateCommandInternalOptions,
) {
  const payload = createCommandSchema.parse(input);
  const teamId = resolveCommandTeamId(payload.teamId, session);
  const rawKey = payload.idempotencyKey;
  // Internal producers recover by their stable keys. A public submission must
  // never occupy those keys, even when it runs under the same service account.
  const storedKey = rawKey && source === "api"
    ? `api:${createHash("sha256").update(JSON.stringify([teamId, payload.requesterId, rawKey])).digest("hex")}`
    : rawKey;
  const visibleTargets = {
    select: SUBMISSION_TARGET_SELECT,
    ...(session ? { where: { server: { AND: [{ teamId }, serverTeamWhere(session)] } } } : {}),
  };

  async function replay(idempotencyKey: string, legacyPublic = false) {
    const existing = await prisma.commandRequest.findFirst({
      where: { idempotencyKey, teamId, requesterId: payload.requesterId, ...(session ? { AND: commandRequestTeamWhere(session) } : {}) },
      include: { targets: { select: { serverId: true } } },
    });
    if (!existing) return null;
    if (legacyPublic && RESERVED_COMMAND_KEY.test(idempotencyKey)) {
      throw new ConflictError(t("backend.command.idempotencyKeyInUse"));
    }
    const serverIds = new Set(existing.targets.map(target => target.serverId));
    if (existing.command !== payload.command || serverIds.size !== payload.serverIds.length ||
        payload.serverIds.some(id => !serverIds.has(id))) {
      throw new ConflictError(t("backend.command.idempotencyKeyInUse"));
    }
    // The comparison needs every original target. The caller only receives
    // the currently readable targets, without command output or credentials.
    const targets = await prisma.commandTarget.findMany({
      ...visibleTargets, where: { commandRequestId: existing.id, ...visibleTargets.where },
    });
    return {
      ...existing,
      targets,
      origin: inferCommandOrigin(existing),
      requiresApproval: existing.status === "PENDING_APPROVAL",
    };
  }

  if (storedKey) {
    const existing = await replay(storedKey);
    if (existing) return existing;
    // Read old public keys for clients retrying a submission across an upgrade.
    // The legacy lookup enforces the same author, team, payload and read scope.
    if (rawKey && storedKey !== rawKey) {
      const legacy = await replay(rawKey, true);
      if (legacy) return legacy;
    }
  }

  // Scope servers by session teamWhere, or by stamped teamId on system paths
  // (playbook executor never has a session but always passes teamId).
  const targetServers = await assertCommandTargetServersInScope(payload.serverIds, session, teamId);

  const origin = deriveCommandOrigin({
    source,
    explicitOrigin: internalOptions?.origin,
    viaToken: internalOptions?.viaToken,
    storedKey,
    submissionMode: payload.submissionMode,
  });
  const assessment = classifyCommandRiskForTargets(
    payload.command,
    targetServers.map((server) => server.operatingSystem),
  );
  const policies = await getApprovalPolicySettings({ fresh: true });

  let requiresApproval: boolean;
  let decisionSource: CommandDecisionSource | null = null;

  if (internalOptions?.approveOnCreate) {
    if (session) {
      if (!sessionHasPermission(session, "command:approve")) {
        throw new ForbiddenError(t("backend.ai.permissionDenied.required", { permission: "command:approve" }));
      }
      if (!mayReviewCommandRequest(session, payload.requesterId, null, false, policies.commandSelfReview)) {
        throw new BusinessError(t("backend.command.cannotSelfReview"));
      }
    }
    requiresApproval = false;
    decisionSource =
      internalOptions.approveOnCreate.approverId === payload.requesterId
        ? "SELF_REVIEW"
        : internalOptions.approveOnCreate.decisionSource;
  } else if (origin === "PLAYBOOK") {
    requiresApproval = false;
    decisionSource = "PLAYBOOK_EXEMPT";
  } else if (origin === "SCHEDULED_TASK") {
    // Scheduled task approval is fixed when saved, except global `always` overrides unattended runs.
    if (policies.commandApprovalPolicy === "always") {
      requiresApproval = true;
    } else {
      requiresApproval = payload.approvalRequired ?? false;
      if (!requiresApproval) decisionSource = "STANDING_APPROVAL";
    }
  } else if (origin === "AI_AUTOMATION" && payload.approvalRequired === false) {
    // Standing approve_once automation: enforce AI policy, risk/denylist, execute permission, and self-review SoD.
    const submitterMayExecute =
      internalOptions?.submitterMayExecute !== undefined
        ? internalOptions.submitterMayExecute
        : !session || sessionHasPermission(session, "command:execute");
    const decision = decideCommandApproval({
      policies,
      origin: "AI_AUTOMATION",
      riskLevel: assessment.level,
      denylisted: assessment.denylisted,
      submitterMayExecute,
      requestedReview: false,
    });
    const canSelfApprove = !session || maySelfReviewCommands(session, policies.commandSelfReview);
    if (
      decision.effectivePolicy === "always" ||
      !submitterMayExecute ||
      (decision.requiresApproval && !canSelfApprove)
    ) {
      requiresApproval = true;
    } else {
      requiresApproval = false;
      decisionSource = "STANDING_APPROVAL";
    }
  } else {
    const submitterMayExecute =
      internalOptions?.submitterMayExecute !== undefined
        ? internalOptions.submitterMayExecute
        : session
          ? sessionHasPermission(session, "command:execute")
          : (origin === "DEPLOYMENT" || origin === "DEPLOYMENT_ROLLBACK"
            ? true
            : payload.submissionMode === "user");
    const decision = decideCommandApproval({
      policies,
      origin,
      riskLevel: assessment.level,
      denylisted: assessment.denylisted,
      submitterMayExecute,
      requestedReview: payload.approvalRequired === true,
    });
    requiresApproval = decision.requiresApproval;
    if (!requiresApproval) {
      decisionSource = internalOptions?.decisionSource ?? "POLICY_DIRECT";
    }
  }

  const status = requiresApproval ? "PENDING_APPROVAL" : "APPROVED";
  const approveOnCreate = !requiresApproval ? internalOptions?.approveOnCreate : undefined;
  let commandRequest: Awaited<ReturnType<typeof prisma.commandRequest.create>> & {
    targets: Prisma.CommandTargetGetPayload<{ select: typeof SUBMISSION_TARGET_SELECT }>[];
  };
  try {
    const insert = (db: Prisma.TransactionClient) => db.commandRequest.create({
      data: {
        title: payload.title,
        command: payload.command,
        reason: payload.reason,
        requesterId: payload.requesterId,
        initiatedByType: toInitiatedByType(payload.submissionMode) as
          | "USER"
          | "ASSISTANT",
        origin,
        riskLevel: assessment.level,
        riskReasons: assessment.reasons,
        decisionSource,
        status,
        teamId,
        idempotencyKey: storedKey ?? null,
        targets: {
          create: payload.serverIds.map((serverId) => ({ serverId, status })),
        },
      },
      include: { targets: visibleTargets },
    });
    const needsTransaction = Boolean(recordCreation || approveOnCreate);
    commandRequest = needsTransaction ? await prisma.$transaction(async tx => {
      const created = await insert(tx);
      if (approveOnCreate) {
        const targets = await tx.commandTarget.findMany({
          where: { commandRequestId: created.id },
          select: { id: true, serverId: true, server: { select: approvalEndpointSelect } },
        });
        if (targets.length > 0) {
          await tx.executionLog.createMany({
            data: targets.map((target) => ({
              id: approvalReceiptId(target.id, target.server),
              commandRequestId: created.id,
              serverId: target.serverId,
              summary: `Approved endpoint ${target.server.username}@${target.server.host}:${target.server.port}`,
            })),
          });
        }
        await tx.commandApproval.create({
          data: {
            commandRequestId: created.id,
            approverId: approveOnCreate.approverId,
            approved: true,
            comment: approveOnCreate.comment ?? null,
          },
        });
      }
      if (recordCreation) {
        await recordCreation(tx, created.id);
      }
      return created;
    }) : await insert(prisma);
  } catch (error) {
    if (storedKey && isUniqueViolation(error)) {
      const existing = await replay(storedKey);
      if (existing) return existing;
      throw new ConflictError(t("backend.command.idempotencyKeyInUse"));
    }
    throw error;
  }

  if (!requiresApproval) {
    // The request is durably APPROVED: if enqueuing fails now, the command
    // maintenance worker enqueues it on its next sweep. Throwing would tell
    // callers nothing was created while the command still runs (a deployment
    // or AI action marked failed, or a retry creating a second command).
    await enqueueApprovedCommandExecution(
      commandRequest.id,
      t("backend.command.enqueuedFromCreate"),
    ).catch((error) => {
      commandLogger.warn("enqueue after create failed; left for the maintenance worker", {
        commandRequestId: commandRequest.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    // Notify requester that command execution has started; final status will be visible on the task row/logs.
    notifyCommandResult(payload.requesterId, payload.title, "approved", commandRequest.teamId, commandRequest.id).catch((err) => { commandLogger.warn("notifyCommandResult failed", { error: err instanceof Error ? err.message : String(err) }); });
  } else {
    // Notify admins about pending command approval
    notifyCommandPending(payload.requesterId, payload.title, commandRequest.teamId, commandRequest.id).catch((err) => { commandLogger.warn("notifyCommandPending failed", { error: err instanceof Error ? err.message : String(err) }); });
  }

  return {
    ...commandRequest,
    origin,
    riskLevel: assessment.level,
    riskReasons: assessment.reasons,
    decisionSource,
    requiresApproval,
  };
}

export async function reviewCommandRequest(
  input: ReviewCommandInput,
  session?: CommandSessionScope | null,
) {
  const payload = reviewCommandSchema.parse(input);
  const request = await prisma.commandRequest.findFirst({
    where: {
      id: payload.commandRequestId,
      // Quarantine null-team requests: a team user must not approve/reject
      // another team's (or unassigned legacy) request.
      ...(session ? commandRequestTeamWhere(session) : {}),
    },
    include: { scheduledTaskRuns: { where: { manual: true }, select: { manual: true }, take: 1 } },
  });

  if (!request) {
    throw new NotFoundError(t("backend.command.requestNotFound"));
  }

  if (request.status !== "PENDING_APPROVAL") {
    throw new BusinessError(t("backend.command.notPendingApproval"));
  }

  // Separation of duties: requester cannot approve/reject their own request
  // (even if they also hold command:approve). Admins with team:manage (or
  // approvers when platform `command.selfReview = "approvers"`) may still
  // self-review in single-operator deployments.
  const policies = await getApprovalPolicySettings({ fresh: true });
  const initiator = manualRunInitiator(request.idempotencyKey);
  const legacyManual = request.scheduledTaskRuns?.length && !initiator;
  const isSelfReview = request.requesterId === payload.approverId || initiator === payload.approverId || Boolean(legacyManual);
  if (isSelfReview && !maySelfReviewCommands(session, policies.commandSelfReview)) {
    throw new BusinessError(t("backend.command.cannotSelfReview"));
  }

  const nextStatus = payload.approved ? "APPROVED" : "REJECTED";
  const reviewDecisionSource: CommandDecisionSource = isSelfReview ? "SELF_REVIEW" : "REVIEWER";
  const reviewTargetScope = session && payload.approved
    ? { server: { AND: [{ teamId: request.teamId }, serverTeamWhere(session)] } }
    : null;

  // Atomic compare-and-swap: prevent concurrent approvers from double-executing
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.commandRequest.updateMany({
      where: {
        id: payload.commandRequestId,
        status: "PENDING_APPROVAL",
        ...(reviewTargetScope ? { targets: { every: reviewTargetScope } } : {}),
        ...(session ? commandRequestTeamWhere(session) : {}),
      },
      data: payload.approved
        ? { status: nextStatus, decisionSource: reviewDecisionSource }
        : { status: nextStatus, decisionSource: reviewDecisionSource, workerId: null, workerHeartbeatAt: null },
    });

    if (claimed.count === 0) {
      if (reviewTargetScope && await tx.commandTarget.findFirst({
        where: { commandRequestId: request.id, NOT: reviewTargetScope },
        select: { id: true },
      })) {
        throw new ForbiddenError(t("backend.command.targetsOutOfScope"));
      }
      throw new BusinessError(t("backend.command.alreadyReviewed"));
    }
    if (payload.approved) {
      const targets = await tx.commandTarget.findMany({
        where: { commandRequestId: request.id }, select: { id: true, serverId: true, server: { select: approvalEndpointSelect } },
      });
      await tx.executionLog.createMany({ data: targets.map(target => ({
        id: approvalReceiptId(target.id, target.server), commandRequestId: request.id, serverId: target.serverId,
        summary: `Approved endpoint ${target.server.username}@${target.server.host}:${target.server.port}`,
      })) });
    }
    await tx.commandApproval.create({
      data: {
        commandRequestId: payload.commandRequestId,
        approverId: payload.approverId,
        approved: payload.approved,
        comment: payload.comment,
      },
    });
    if (!payload.approved) {
      await tx.commandTarget.updateMany({
        where: { commandRequestId: payload.commandRequestId },
        data: {
          status: "REJECTED",
          finishedAt: new Date(),
        },
      });

      await tx.executionLog.create({
        data: {
          commandRequestId: payload.commandRequestId,
          serverId: null,
          summary: t("backend.command.rejectedSummary"),
        },
      });
    }
  });

  if (payload.approved) {
    // Notify requester: command approved
    notifyCommandResult(request.requesterId, request.title, "approved", request.teamId, request.id).catch((err) => { commandLogger.warn("notifyCommandResult failed", { error: err instanceof Error ? err.message : String(err) }); });

    // The approval is committed; a failed enqueue is retried by the
    // maintenance worker, so it must not report the approval as failed.
    await enqueueApprovedCommandExecution(
      payload.commandRequestId,
      t("backend.command.enqueuedFromApproval"),
    ).catch((error) => {
      commandLogger.warn("enqueue after approval failed; left for the maintenance worker", {
        commandRequestId: payload.commandRequestId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return prisma.commandRequest.findUniqueOrThrow({
      where: { id: payload.commandRequestId },
    });
  }

  // Notify requester: command rejected
  notifyCommandResult(request.requesterId, request.title, "rejected", request.teamId, request.id).catch((err) => { commandLogger.warn("notifyCommandResult failed", { error: err instanceof Error ? err.message : String(err) }); });
  await import("@/lib/ai/hosted-outcome")
    .then(({ projectCommandOutcomeToHostedAction }) => projectCommandOutcomeToHostedAction(payload.commandRequestId))
    .catch(() => undefined);

  // Return post-CAS row (same as approve path). The pre-tx `request` snapshot
  // still has status PENDING_APPROVAL and would mislead API/UI clients.
  return prisma.commandRequest.findUniqueOrThrow({
    where: { id: payload.commandRequestId },
  });
}

const COMMAND_LIST_INCLUDE = {
  _count: { select: { targets: true } },
  scheduledTaskRuns: { where: { manual: true }, select: { manual: true }, take: 1 },
  requester: { select: { id: true, username: true, displayName: true } },
  approvals: {
    orderBy: { createdAt: "desc" },
    take: 10,
    include: {
      approver: { select: { id: true, username: true, displayName: true } },
    },
  },
  targets: {
    orderBy: { id: "asc" },
    select: {
      id: true, status: true, executionChannel: true, fallbackReason: true, outcomeUnknown: true, finishedAt: true,
      server: { select: { id: true, name: true, host: true, port: true, teamId: true } },
    },
  },
  executionLogs: { orderBy: { createdAt: "desc" }, take: RECENT_COMMAND_LOG_LIMIT },
} satisfies Prisma.CommandRequestInclude;

/** Requests still waiting for a decision or an execution: the ones people act on. */
const OPEN_COMMAND_STATUSES: CommandRequestStatus[] = ["PENDING_APPROVAL", "APPROVED", "RUNNING", "CANCELLING"];
const COMMAND_HISTORY_LIMIT = 100;
const OPEN_COMMAND_LIMIT = 500;

export type CommandRequestListFilter = "all" | "waiting_on_me" | "my_submissions" | "open" | "history";

export type CommandRequestListOptions = {
  filter?: CommandRequestListFilter;
  origin?: CommandOrigin;
};

function originFilterWhere(origin: CommandOrigin): Prisma.CommandRequestWhereInput {
  switch (origin) {
    case "DEPLOYMENT":
      return { OR: [{ origin: "DEPLOYMENT" }, { origin: null, idempotencyKey: { startsWith: "deployment:" } }] };
    case "DEPLOYMENT_ROLLBACK":
      return { OR: [{ origin: "DEPLOYMENT_ROLLBACK" }, { origin: null, idempotencyKey: { startsWith: "deployment-rollback:" } }] };
    case "AI_CHAT":
      return {
        OR: [
          { origin: "AI_CHAT" },
          { origin: null, idempotencyKey: { startsWith: "ai-hosted-action:" } },
          { origin: null, idempotencyKey: null, initiatedByType: "ASSISTANT" },
        ],
      };
    case "AI_AUTOMATION":
      return { OR: [{ origin: "AI_AUTOMATION" }, { origin: null, idempotencyKey: { startsWith: "ai-automation:" } }] };
    case "SCHEDULED_TASK":
      return { OR: [{ origin: "SCHEDULED_TASK" }, { origin: null, idempotencyKey: { startsWith: "scheduled-task:" } }] };
    case "PLAYBOOK":
      return { OR: [{ origin: "PLAYBOOK" }, { origin: null, idempotencyKey: { startsWith: "playbook:" } }] };
    case "API":
      return { OR: [{ origin: "API" }, { origin: null, idempotencyKey: { startsWith: "api:" } }] };
    case "USER_UI":
    default:
      return {
        OR: [
          { origin: "USER_UI" },
          { origin: null, initiatedByType: "USER", idempotencyKey: null },
        ],
      };
  }
}

export async function listCommandRequestPage(
  session?: CommandSessionScope | null,
  cursor?: string,
  pageSize = OPEN_COMMAND_LIMIT,
  options?: CommandRequestListOptions,
) {
  // Quarantine null-team requests from team-user lists (command text + targets
  // are a security root); global managers still see all via commandRequestTeamWhere.
  const baseTeamWhere: Prisma.CommandRequestWhereInput = session ? { ...commandRequestTeamWhere(session) } : {};
  const extraClauses: Prisma.CommandRequestWhereInput[] = [];
  if (options?.origin) {
    extraClauses.push(originFilterWhere(options.origin));
  }
  const filter = options?.filter ?? "all";
  if (filter === "my_submissions" && session) {
    extraClauses.push({ requesterId: session.userId });
  } else if (filter === "waiting_on_me" && session) {
    if (!sessionHasPermission(session, "command:approve")) {
      return { requests: [], nextCursor: null, pendingCount: 0 };
    }
    const policies = await getApprovalPolicySettings();
    extraClauses.push({ status: "PENDING_APPROVAL" });
    if (!maySelfReviewCommands(session, policies.commandSelfReview)) {
      extraClauses.push(
        { requesterId: { not: session.userId } },
        { OR: [{ idempotencyKey: null }, { NOT: { idempotencyKey: { startsWith: escapeLikeLiteral(manualRunPrefix(session.userId)) } } }] },
        { OR: [{ scheduledTaskRuns: { none: { manual: true } } }, { idempotencyKey: { startsWith: manualRunKeyPrefix } }] },
      );
    }
  }
  const where: Prisma.CommandRequestWhereInput =
    extraClauses.length > 0 ? { AND: [baseTeamWhere, ...extraClauses] } : baseTeamWhere;

  const canReadServers = !session || sessionHasPermission(session, "server:read");
  const take = Math.max(1, Math.min(pageSize, OPEN_COMMAND_LIMIT));
  const include = {
    ...COMMAND_LIST_INCLUDE,
    targets: { ...COMMAND_LIST_INCLUDE.targets, ...(session ? { where: { server: canReadServers ? serverTeamWhere(session) : { id: { in: [] } } } } : {}) },
  };
  const includeOpen = filter !== "history";
  const includeHistory = filter === "all" || filter === "my_submissions" || filter === "history";
  const [open, recent, pendingCount] = await Promise.all([
    includeOpen
      ? prisma.commandRequest.findMany({
          where: { AND: [where, { status: { in: OPEN_COMMAND_STATUSES } }, ...(cursor ? [createdBeforeCursor(cursor)] : [])] },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: take + 1,
          include,
        })
      : Promise.resolve([]),
    includeHistory && (filter === "history" || !cursor)
      ? prisma.commandRequest.findMany({
          where: { AND: [where, { status: { notIn: OPEN_COMMAND_STATUSES } }, ...(filter === "history" && cursor ? [createdBeforeCursor(cursor)] : [])] },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: filter === "history" ? take + 1 : COMMAND_HISTORY_LIMIT,
          include,
        })
      : Promise.resolve([]),
    prisma.commandRequest.count({ where: { AND: [baseTeamWhere, { status: "PENDING_APPROVAL" }] } }),
  ]);
  const seen = new Set<string>();
  const slicedOpen = open.slice(0, take);
  const slicedRecent = filter === "history" ? recent.slice(0, take) : recent;
  const requests = [...slicedOpen, ...slicedRecent]
    .filter((request) => !seen.has(request.id) && seen.add(request.id))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const boundary = filter === "history"
    ? (recent.length > take ? recent[take - 1] : null)
    : (open.length > take ? open[take - 1] : null);
  const visibleRows = await withVisibleCommandLogs(requests, session);
  const canApprove = !session || sessionHasPermission(session, "command:approve");
  return {
    requests: visibleRows.map(row => {
      if (!session) return mapCommandRequest(row);
      const targets = canReadServers ? row.targets.filter(target => target.server.teamId === row.teamId) : [];
      const bodyReadable = canReadCommandBody(session.userId, row.requesterId, canApprove);
      const executionLogs = canReadServers
        ? (bodyReadable
            ? row.executionLogs
            : row.executionLogs.map((log) => ({ ...log, stdout: null, stderr: null })))
        : [];
      return mapCommandRequest({
        ...row, targets, _count: { targets: targets.length },
        executionLogs,
      });
    }),
    nextCursor: boundary ? boundary.createdAt.getTime() + "." + boundary.id : null,
    pendingCount,
  };
}

export async function getCommandRequestForViewer(session: CommandSessionScope, id: string) {
  const trimmed = id.trim();
  if (!trimmed || trimmed.length > 64) return null;
  const canReadServers = sessionHasPermission(session, "server:read");
  const include = {
    ...COMMAND_LIST_INCLUDE,
    targets: {
      ...COMMAND_LIST_INCLUDE.targets,
      where: { server: canReadServers ? serverTeamWhere(session) : { id: { in: [] } } },
    },
  };
  const row = await prisma.commandRequest.findFirst({
    where: {
      id: trimmed,
      ...commandRequestTeamWhere(session),
    },
    include,
  });
  if (!row) return null;
  const [visibleRow] = await withVisibleCommandLogs([row], session);
  if (!visibleRow) return null;
  const targets = canReadServers ? visibleRow.targets.filter((target) => target.server.teamId === visibleRow.teamId) : [];
  return mapCommandRequest({
    ...visibleRow,
    targets,
    _count: { targets: targets.length },
    executionLogs: canReadServers ? visibleRow.executionLogs : [],
  });
}

/**
 * Safe API serializer for GET /api/commands/[id] and /commands?fromRequestId=:
 * - Enforces commandRequestTeamWhere + canReadCommandBody.
 * - Masks `command: ""` + `commandHidden: true` and omits logs/outputs for non-owner, non-approver viewers.
 * - Enriches authorized viewers with bounded, secret-masked per-target stdout/stderr + exitCode.
 */
export async function getCommandRequestDetailForViewer(session: CommandSessionScope, id: string) {
  const request = await getCommandRequestForViewer(session, id);
  if (!request) return null;
  const canApprove = sessionHasPermission(session, "command:approve");
  const canReadServers = sessionHasPermission(session, "server:read");
  const bodyReadable = canReadCommandBody(session.userId, request.requesterId, canApprove);

  if (!bodyReadable) {
    return {
      ...request,
      command: "",
      commandHidden: true,
      executionLogs: [],
      latestLog: null,
      targets: request.targets.map((target) => ({
        ...target,
        exitCode: null as number | null,
        stdout: null as string | null,
        stderr: null as string | null,
      })),
    };
  }

  const targetIds = request.targets.map((target) => target.id);
  const [tails, exitCodeRows] = canReadServers && targetIds.length > 0
    ? await Promise.all([
        fetchTargetOutputTails(targetIds, session, COMMAND_DETAIL_OUTPUT_TAIL_CHARS),
        prisma.commandTarget.findMany({
          where: { id: { in: targetIds } },
          select: { id: true, exitCode: true },
        }),
      ])
    : [new Map(), []];
  const exitCodeById = new Map(exitCodeRows.map((row) => [row.id, row.exitCode]));

  return {
    ...request,
    commandHidden: false,
    targets: request.targets.map((target) => {
      const tail = tails.get(target.id);
      return {
        ...target,
        exitCode: exitCodeById.get(target.id) ?? null,
        stdout: canReadServers ? maskCommandOutput(tail?.stdout ?? null, COMMAND_DETAIL_OUTPUT_TAIL_CHARS) : null,
        stderr: canReadServers ? maskCommandOutput(tail?.stderr ?? null, COMMAND_DETAIL_OUTPUT_TAIL_CHARS) : null,
      };
    }),
  };
}

export async function listCommandRequests(session?: CommandSessionScope | null) {
  const first = await listCommandRequestPage(session);
  const requests = first.requests;
  let cursor = first.nextCursor;
  while (cursor) {
    const next = await listCommandRequestPage(session, cursor);
    requests.push(...next.requests);
    cursor = next.nextCursor;
  }
  return requests;
}
