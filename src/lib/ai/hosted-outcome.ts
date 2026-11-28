/**
 * Idempotent terminal outcome projection from CommandRequest -> AiHostedAction
 * and its paired `role: "tool"` AiMessage.
 *
 * Called best-effort after commit from ALL terminal CommandRequest paths:
 * - settleCommandRequest (normal execution completion / failure / cancel)
 * - cancelCommandRequest (pre-execution cancellation)
 * - reviewCommandRequest (reviewer rejection)
 * - recoverStaleRunningCommandRequests (stale executor loss)
 * - recoverInterruptedHostedActions (maintenance reconciliation)
 * - GET /api/ai/hosted-actions/[id] (on-demand read self-healing)
 */
import type { AiHostedActionStatus, CommandRequestStatus, Prisma } from "@prisma/client";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { assertRequesterMayExecuteCommand } from "@/lib/auth/command-execution-authz";
import { serverTeamWhere, teamWhere } from "@/lib/auth/team-scope";
import { maskCommandOutput } from "@/lib/command/output-masker";
import { COMMAND_DETAIL_OUTPUT_TAIL_CHARS, fetchTargetOutputTails } from "@/lib/command/target-output";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";
import { type HostedActionSession, sessionForTeamScope } from "./hosted-helpers";
import { withHostedServerSnapshot } from "./hosted-snapshot";

const logger = createLogger("ai:hosted-outcome");

const TERMINAL_COMMAND_STATUSES = new Set<CommandRequestStatus>([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "REJECTED",
]);

const NON_TERMINAL_ACTION_STATUSES: AiHostedActionStatus[] = [
  "PENDING_APPROVAL",
  "APPROVED",
  "EXECUTING",
];

function mapTerminalStatus(status: CommandRequestStatus): AiHostedActionStatus | null {
  switch (status) {
    case "COMPLETED":
      return "COMPLETED";
    case "FAILED":
      return "FAILED";
    case "CANCELLED":
      return "CANCELLED";
    case "REJECTED":
      return "REJECTED";
    default:
      return null;
  }
}

function parseRiskReasons(value: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function parseStoredObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed JSON
  }
  return {};
}

async function upsertToolMessage(
  tx: Prisma.TransactionClient,
  action: { id: string; conversationId: string; toolCallId: string | null },
  outcome: Record<string, unknown>,
) {
  if (!action.toolCallId) return;
  const content = JSON.stringify({ actionId: action.id, ...outcome });
  const where = { conversationId: action.conversationId, role: "tool", toolCallId: action.toolCallId };
  const updated = await tx.aiMessage.updateMany({
    where: { ...where, id: action.id },
    data: { content },
  });
  if (updated.count) return;
  await tx.aiMessage.upsert({
    where: { id: action.id },
    update: { content },
    create: { ...where, id: action.id, content },
  });
}

/**
 * Project a terminal CommandRequest outcome back onto its linked AiHostedAction
 * and tool AiMessage. Idempotent and forward-only: never overwrites an already
 * terminal AiHostedAction and never throws into calling workers/routes.
 */
export async function projectCommandOutcomeToHostedAction(commandRequestId: string): Promise<boolean> {
  try {
    const commandDelegate = (prisma as unknown as {
      commandRequest?: { findUnique?: (args: unknown) => Promise<unknown> };
      aiHostedAction?: { findFirst?: (args: unknown) => Promise<unknown> };
    }).commandRequest;
    const hostedDelegate = (prisma as unknown as {
      aiHostedAction?: { findFirst?: (args: unknown) => Promise<unknown> };
    }).aiHostedAction;
    if (!commandDelegate?.findUnique || !hostedDelegate?.findFirst) return false;

    const command = await prisma.commandRequest.findUnique({
      where: { id: commandRequestId },
      select: {
        id: true,
        status: true,
        command: true,
        teamId: true,
        requesterId: true,
        idempotencyKey: true,
        riskReasons: true,
        approvals: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { approved: true, comment: true },
        },
      },
    });
    if (!command || !TERMINAL_COMMAND_STATUSES.has(command.status)) return false;

    const mappedStatus = mapTerminalStatus(command.status);
    if (!mappedStatus) return false;

    // Locate linked AiHostedAction FIRST with a lightweight query so ordinary non-AI
    // commands never load commandTarget stdout/stderr a second time.
    const legacyActionId = command.idempotencyKey?.startsWith("ai-hosted-action:")
      ? command.idempotencyKey.slice("ai-hosted-action:".length)
      : command.idempotencyKey?.startsWith("ai-automation:")
        ? command.idempotencyKey.slice("ai-automation:".length)
        : null;

    const action = await prisma.aiHostedAction.findFirst({
      where: {
        OR: [
          { commandRequestId: command.id },
          ...(legacyActionId ? [{ id: legacyActionId }] : []),
        ],
        teamId: command.teamId,
      },
      select: {
        id: true,
        conversationId: true,
        toolCallId: true,
        requesterId: true,
        teamId: true,
        status: true,
        riskReasons: true,
        commandRequestId: true,
        completedAt: true,
      },
    });
    if (!action) return false;
    // Never overwrite a card that is already terminal with its final result projected.
    if (!NON_TERMINAL_ACTION_STATUSES.includes(action.status)) return false;

    const targetDelegate = (prisma as unknown as {
      commandTarget?: { findMany?: (args: unknown) => Promise<unknown> };
    }).commandTarget;
    const rawTargets = targetDelegate?.findMany
      ? await prisma.commandTarget.findMany({
          where: { commandRequestId: command.id },
          orderBy: { id: "asc" },
          select: {
            id: true,
            serverId: true,
            status: true,
            exitCode: true,
            stdout: true,
            stderr: true,
            finishedAt: true,
            outcomeUnknown: true,
            server: { select: { id: true, name: true, host: true, teamId: true } },
          },
        })
      : [];
    const commandTargets = Array.isArray(rawTargets) ? rawTargets : [];

    // Re-check live requester authorization and sensitive-path policy before exposing output to the model.
    const combinedRiskReasons = [
      ...parseRiskReasons(action.riskReasons),
      ...parseRiskReasons(command.riskReasons),
    ];
    const sensitivePath = combinedRiskReasons.includes("high.sensitive_path");
    let requesterAuthorized = true;
    try {
      const targetServerIds = commandTargets
        .filter((target) => target.server.teamId === command.teamId)
        .map((target) => target.serverId);
      for (const serverId of targetServerIds) {
        const authz = await assertRequesterMayExecuteCommand(
          action.requesterId,
          action.teamId,
          serverId,
          { requireExecutePermission: false },
        );
        if (!authz.ok) {
          requesterAuthorized = false;
          break;
        }
      }
    } catch {
      requesterAuthorized = false;
    }

    const redactOutput = !requesterAuthorized || sensitivePath;
    const targetSummaries = commandTargets
      .filter((target) => target.server.teamId === command.teamId)
      .map((target) => ({
        targetId: target.id,
        serverId: target.serverId,
        serverName: target.server.name,
        status: target.status,
        exitCode: target.exitCode,
        outcomeUnknown: target.outcomeUnknown,
        stdout: redactOutput ? null : maskCommandOutput(target.stdout, 5_000),
        stderr: redactOutput ? null : maskCommandOutput(target.stderr, 2_000),
      }));

    const firstTarget = targetSummaries[0];
    const rejectionComment = command.approvals[0] && !command.approvals[0].approved
      ? command.approvals[0].comment
      : null;

    const executed = command.status === "COMPLETED" || command.status === "FAILED";
    const errorMessage =
      mappedStatus === "COMPLETED"
        ? null
        : mappedStatus === "REJECTED"
          ? rejectionComment || "Command request was rejected by reviewer"
          : mappedStatus === "CANCELLED"
            ? "Command request was cancelled"
            : firstTarget?.stderr?.trim() || `Command exited with code ${firstTarget?.exitCode ?? 255}`;

    const resultPayload: Record<string, unknown> = {
      commandRequestId: command.id,
      requiresApproval: false,
      executed,
      status: mappedStatus,
      command: command.command,
      exitCode: firstTarget?.exitCode ?? null,
      stdout: redactOutput ? null : (firstTarget?.stdout ?? null),
      stderr: redactOutput ? null : (firstTarget?.stderr ?? null),
      targets: targetSummaries,
      ...(redactOutput ? { redacted: true, redactReason: sensitivePath ? "sensitive_path" : "authorization_changed" } : {}),
    };

    const toolOutcome: Record<string, unknown> = {
      success: mappedStatus === "COMPLETED",
      executed,
      retryable: false,
      status: mappedStatus,
      commandRequestId: command.id,
      command: command.command,
      exitCode: firstTarget?.exitCode ?? null,
      ...(redactOutput
        ? { redacted: true, note: sensitivePath ? "Output withheld from AI model because command touched a sensitive path." : "Output withheld because caller permissions changed." }
        : { stdout: firstTarget?.stdout ?? "", stderr: firstTarget?.stderr ?? "" }),
      ...(errorMessage ? { error: errorMessage } : {}),
    };

    const now = new Date();
    const projected = await prisma.$transaction(async (tx) => {
      // Lock parent conversation row first (same lock order as clear/delete).
      const [conv] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT c.id FROM ai_conversations c
        JOIN ai_hosted_actions a ON a."conversationId" = c.id
        WHERE a.id = ${action.id}
        FOR SHARE OF c
      `;
      if (!conv) return false;
      const claimed = await tx.aiHostedAction.updateMany({
        where: { id: action.id, status: { in: NON_TERMINAL_ACTION_STATUSES } },
        data: {
          status: mappedStatus,
          commandRequestId: command.id,
          result: JSON.stringify(resultPayload),
          errorMessage: errorMessage ? errorMessage.slice(0, 2000) : null,
          completedAt: now,
        },
      });
      if (claimed.count === 0) return false;
      await upsertToolMessage(tx, action, toolOutcome);
      return true;
    });

    return projected;
  } catch (error) {
    logger.warn("projectCommandOutcomeToHostedAction failed", {
      commandRequestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function sanitizeStoredActionResult(
  rawResult: string | null | undefined,
  visibleServerIds: ReadonlySet<string> | null,
): string | null {
  if (!rawResult) return rawResult ?? null;
  if (visibleServerIds === null) return rawResult;
  const parsed = parseStoredObject(rawResult);
  if (Object.keys(parsed).length === 0) return rawResult;
  const next: Record<string, unknown> = { ...parsed };
  const rawTargets = Array.isArray(parsed.targets) ? parsed.targets : null;
  if (rawTargets) {
    let anyRedacted = false;
    const filteredTargets = rawTargets.filter((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const target = entry as Record<string, unknown>;
      const serverId = typeof target.serverId === "string" ? target.serverId : null;
      if (!serverId || !visibleServerIds.has(serverId)) {
        anyRedacted = true;
        return false;
      }
      return true;
    });
    if (visibleServerIds.size === 0) {
      delete next.targets;
    } else {
      next.targets = filteredTargets;
    }
    if (anyRedacted || visibleServerIds.size === 0) {
      next.stdout = null;
      next.stderr = null;
      next.redacted = true;
    }
  } else if (visibleServerIds.size === 0) {
    next.stdout = null;
    next.stderr = null;
    next.redacted = true;
  }
  return JSON.stringify(next);
}

/**
 * Requester-scoped live status + bounded masked output for a single hosted
 * action, used by GET /api/ai/hosted-actions/[id] to poll inline execution.
 */
export async function getHostedActionLiveStatus(actionId: string, session: HostedActionSession) {
  const teamScope = sessionForTeamScope(session);
  if (!teamScope) return null;
  const actionScope = session.currentTeamId
    ? { teamId: session.currentTeamId }
    : teamWhere(teamScope);
  const action = await prisma.aiHostedAction.findFirst({
    where: {
      id: actionId,
      requesterId: session.userId,
      ...actionScope,
    },
    select: {
      id: true,
      conversationId: true,
      messageId: true,
      toolCallId: true,
      serverId: true,
      teamId: true,
      actionType: true,
      actionName: true,
      params: true,
      status: true,
      riskLevel: true,
      effectiveRisk: true,
      riskReasons: true,
      decisionSource: true,
      modeAtDecision: true,
      commandRequestId: true,
      autoApproved: true,
      result: true,
      errorMessage: true,
      createdAt: true,
      approvedAt: true,
      executedAt: true,
      completedAt: true,
    },
  });
  if (!action) return null;

  const canReadServers = sessionHasPermission(session, "server:read");
  let boundServerVisible = !action.serverId;
  if (action.serverId && canReadServers) {
    const visibleServer = await prisma.server.findFirst({
      where: {
        id: action.serverId,
        teamId: action.teamId,
        AND: [serverTeamWhere(teamScope)],
      },
      select: { id: true },
    });
    boundServerVisible = Boolean(visibleServer);
  }

  const storedResult = parseStoredObject(action.result);
  const linkedCommandId =
    action.commandRequestId ??
    (typeof storedResult.commandRequestId === "string" ? storedResult.commandRequestId : null);

  let command: {
    id: string;
    status: CommandRequestStatus;
    command: string;
    origin: string | null;
    riskLevel: string | null;
    decisionSource: string | null;
    targets: Array<{
      id: string;
      serverId: string;
      serverName: string | null;
      status: CommandRequestStatus;
      exitCode: number | null;
      outcomeUnknown: boolean;
      stdout: string | null;
      stderr: string | null;
      finishedAt: string | null;
    }>;
  } | null = null;
  const visibleServerIds = new Set<string>();
  if (action.serverId && canReadServers && boundServerVisible) {
    visibleServerIds.add(action.serverId);
  }

  if (linkedCommandId) {
    // Self-heal projection if CommandRequest reached a terminal state before this poll.
    if (NON_TERMINAL_ACTION_STATUSES.includes(action.status)) {
      await projectCommandOutcomeToHostedAction(linkedCommandId);
    }
    const cmdRow = await prisma.commandRequest.findFirst({
      where: {
        id: linkedCommandId,
        teamId: action.teamId,
        requesterId: session.userId,
      },
      select: {
        id: true,
        status: true,
        command: true,
        origin: true,
        riskLevel: true,
        decisionSource: true,
        targets: {
          where: canReadServers ? { server: serverTeamWhere(teamScope) } : { id: { in: [] } },
          orderBy: { id: "asc" },
          select: {
            id: true,
            serverId: true,
            status: true,
            exitCode: true,
            outcomeUnknown: true,
            finishedAt: true,
            server: { select: { name: true, teamId: true } },
          },
        },
      },
    });
    if (cmdRow) {
      const visibleTargets = canReadServers
        ? cmdRow.targets.filter((target) => target.server.teamId === action.teamId)
        : [];
      for (const target of visibleTargets) visibleServerIds.add(target.serverId);
      const tails = canReadServers && visibleTargets.length > 0
        ? await fetchTargetOutputTails(
            visibleTargets.map((target) => target.id),
            teamScope,
            COMMAND_DETAIL_OUTPUT_TAIL_CHARS,
          )
        : new Map();
      command = {
        id: cmdRow.id,
        status: cmdRow.status,
        command: cmdRow.command,
        origin: cmdRow.origin,
        riskLevel: cmdRow.riskLevel,
        decisionSource: cmdRow.decisionSource,
        targets: visibleTargets.map((target) => {
          const tail = tails.get(target.id);
          return {
            id: target.id,
            serverId: target.serverId,
            serverName: target.server.name,
            status: target.status,
            exitCode: target.exitCode,
            outcomeUnknown: target.outcomeUnknown,
            stdout: maskCommandOutput(tail?.stdout ?? null, 5_000),
            stderr: maskCommandOutput(tail?.stderr ?? null, 2_000),
            finishedAt: target.finishedAt ? target.finishedAt.toISOString() : null,
          };
        }),
      };
    }
  }

  // Reload the action if projection just transitioned it to terminal.
  const latest =
    linkedCommandId && NON_TERMINAL_ACTION_STATUSES.includes(action.status)
      ? (await prisma.aiHostedAction.findUnique({ where: { id: action.id } })) ?? action
      : action;

  const shouldFilterStoredResult = !canReadServers || !boundServerVisible || Boolean(linkedCommandId);
  const sanitizedLatest = shouldFilterStoredResult
    ? {
        ...latest,
        result: sanitizeStoredActionResult(
          latest.result,
          canReadServers ? visibleServerIds : new Set<string>(),
        ),
      }
    : latest;

  return {
    action: withHostedServerSnapshot(sanitizedLatest),
    command,
  };
}
