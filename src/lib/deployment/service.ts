import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { renderDeploymentCommand, type DeploymentShell } from "./variables";
import { apiCopy } from "@/lib/i18n/api-copy";
import { prisma } from "@/lib/db";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { createCommandRequest } from "@/lib/command/service";
import { commandRequestTitle } from "@/lib/command/schema";
import { commandTemplateScopeWhere, seedBuiltinTemplates } from "@/lib/command-template/service";
import type { SessionPayload } from "@/lib/auth/session";
import { deploymentRunTeamWhere, serverTeamWhere, teamCreateData } from "@/lib/auth/team-scope";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";

// TR-039: pure DTO types live in ./dto so client code can reach them
// without pulling the whole server-only service module. We import them
// for in-file use AND re-export them so every existing call site
// 'from "@/lib/deployment/service"' keeps working.
import { t } from "@/lib/i18n/service-translations";
import { OPERATION_TARGET_SELECT, operationTargetAvailability } from "@/lib/server/availability";

export type SessionScope = Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;

/**
 * Scope for `DeploymentRun` queries. Strict, not the loose `teamWhere`: a run
 * holds the rendered command, its rollback snapshot and the target server ids,
 * and `createDeploymentRollbackRun` replays that snapshot as a real command
 * request. A `teamId: null` row is quarantined legacy data, so it stays
 * invisible to every tenant instead of being readable (and roll-back-able) by
 * all of them.
 */
/**
 * Load a deployment run by id under optional team scope.
 * Mutate paths (rollback) use this so cross-team IDs resolve as not-found (no IDOR).
 */
async function getDeploymentRunForSession(
  id: string,
  session: SessionScope,
  include?: {
    snapshot?: boolean;
    template?: boolean;
  },
) {
  return prisma.deploymentRun.findFirst({
    where: { id, ...deploymentRunTeamWhere(session) },
    include: {
      snapshot: include?.snapshot ?? false,
      template: include?.template ?? false,
    },
  });
}


/**
 * Load the targets, refusing any that the caller cannot see.
 *
 * Both launch and rollback need this: a snapshot stores raw server ids, so a
 * server that has since moved to another customer must not be reachable by
 * replaying an old run.
 */
async function loadDeploymentServersInScope(
  serverIds: string[],
  session: SessionScope,
) {
  const scope = serverTeamWhere(session, "connect");
  const servers = await prisma.server.findMany({
    where: { id: { in: serverIds }, ...scope },
    select: {
      id: true,
      enabled: true,
      ...OPERATION_TARGET_SELECT,
    },
  });
  if (servers.length !== serverIds.length) {
    throw new ValidationError(
      apiCopy("apiCopy.one.or.more.target.servers.were.not.found.or.are.outside.your.te.8f5645a2"),
    );
  }
  return servers;
}

async function deploymentShellForServers(
  serverIds: string[],
  session: SessionScope,
): Promise<DeploymentShell> {
  const servers = await loadDeploymentServersInScope(serverIds, session);
  if (servers.some((server) => server.enabled === false || !operationTargetAvailability(server).available)) {
    throw new ValidationError(t("backend.deployment.targetUnavailable"));
  }
  const windows = servers.filter(server => server.operatingSystem === "WINDOWS").length;
  return windows === 0 ? "posix" : windows === servers.length ? "cmd" : "mixed";
}

function normalizeDeploymentInput(input: {
  templateId: string;
  serverIds: string[];
  variables: Record<string, string>;
  requesterId: string;
  reason?: string;
}) {
  const templateId = input.templateId.trim();
  const requesterId = input.requesterId.trim();
  const serverIds = Array.from(new Set(input.serverIds.map((id) => id.trim()).filter(Boolean)));
  const reason = input.reason?.trim();
  if (!templateId) throw new ValidationError(t("backend.deployment.deploymentTemplateIsRequired"));
  if (!requesterId) throw new ValidationError(t("backend.deployment.requesterIsRequired"));
  if (serverIds.length < 1) throw new ValidationError(t("backend.deployment.atLeast1TargetVpsMustBeSelected"));
  if (reason && reason.length > 500) throw new ValidationError(t("backend.deployment.reasonMustBeAtMost500Characters"));
  return { ...input, templateId, requesterId, serverIds, reason };
}

function assertTemplateVariables(
  command: string,
  templateVariables: string[] | null | undefined,
  variables: Record<string, string>,
  rollbackCommand?: string | null,
) {
  const scan = `${command}\n${rollbackCommand ?? ""}`;
  const placeholders = Array.from(
    scan.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g),
  ).map((match) => match[1]!);
  const required = Array.from(
    new Set([
      ...(Array.isArray(templateVariables) ? templateVariables : []),
      ...placeholders,
    ]),
  ).filter(Boolean);
  const missing = required.filter((name) => !Object.hasOwn(variables, name) || !variables[name]?.trim());
  if (missing.length > 0)
    throw new ValidationError(apiCopy("apiCopy.deployment.template.variables.not.fully.filled.in.a18cdd6c", { v0: String(missing.join(", ")) }));
}

export async function listDeploymentTemplates(session: SessionScope) {
  await seedBuiltinTemplates();
  const where = commandTemplateScopeWhere(session);
  return prisma.commandTemplate.findMany({ ...(Object.keys(where).length > 0 ? { where } : {}), orderBy: [{ isBuiltin: "desc" }, { name: "asc" }], take: 200 });
}

export async function createDeploymentRunFromTemplate(
  input: {
    templateId: string;
    serverIds: string[];
    variables: Record<string, string>;
    requesterId: string;
    reason?: string;
    idempotencyKey?: string;
  },
  session: SessionScope,
) {
  const rawIdempotencyKey = input.idempotencyKey?.trim();
  if (rawIdempotencyKey !== undefined && (!rawIdempotencyKey || rawIdempotencyKey.length > 300))
    throw new ValidationError(t("backend.command.idempotencyKeyInUse"));
  const idempotencyScope = session.currentTeamId
    ? `team:${session.currentTeamId}`
    : `user:${session.userId}`;
  const idempotencyKey = rawIdempotencyKey
    ? "v2:" + createHash("sha256").update(JSON.stringify([idempotencyScope, rawIdempotencyKey])).digest("hex")
    : null;
  if (!idempotencyKey) return createDeploymentRunFromTemplateUnlocked(input, session);
  const release = await acquireAdvisoryLock("deployment", `create:${idempotencyKey}`);
  try {
    return await createDeploymentRunFromTemplateUnlocked({ ...input, idempotencyKey }, session, `${idempotencyScope}:${rawIdempotencyKey}`);
  } finally {
    await release();
  }
}

async function createDeploymentRunFromTemplateUnlocked(
  input: {
    templateId: string;
    serverIds: string[];
    variables: Record<string, string>;
    requesterId: string;
    reason?: string;
    idempotencyKey?: string;
  },
  session: SessionScope,
  legacyKey?: string,
) {
  const normalized = normalizeDeploymentInput(input);
  const shell = await deploymentShellForServers(normalized.serverIds, session);
  const template = await prisma.commandTemplate.findFirst({ where: { id: normalized.templateId, ...commandTemplateScopeWhere(session) } });
  if (!template) throw new NotFoundError(t("backend.deployment.deploymentTemplateNotFound"));
  assertTemplateVariables(
    template.command,
    template.variables,
    normalized.variables,
    template.rollbackCommand,
  );
  const renderedCommand = renderDeploymentCommand(template.command, normalized.variables, shell);
  const renderedRollbackCommand = template.rollbackCommand
    ? renderDeploymentCommand(template.rollbackCommand, normalized.variables, shell)
    : null;

  const teamId = teamCreateData(session).teamId ?? null;
  const idempotencyKey = input.idempotencyKey?.trim() || null;
  if (idempotencyKey) {
    const existing = await prisma.deploymentRun.findFirst({
      where: { idempotencyKey: { in: legacyKey ? [idempotencyKey, legacyKey] : [idempotencyKey] }, teamId, ...deploymentRunTeamWhere(session) },
    });
    if (existing) {
      if (existing.createdBy !== normalized.requesterId || existing.templateId !== template.id ||
          !sameTargets(existing.serverIds, normalized.serverIds) ||
          !isDeepStrictEqual(existing.variables, normalized.variables)) {
        throw new ConflictError(t("backend.command.idempotencyKeyInUse"));
      }
      if (existing.commandRequestId) return existing;
      const command = await submitDeploymentCommand({
        title: commandRequestTitle("Deployment: ", template.name),
        command: existing.renderedCommand,
        reason: normalized.reason || "Recovered deployment request",
        submissionMode: "assistant",
        requesterId: existing.createdBy,
        serverIds: existing.serverIds,
        teamId: existing.teamId,
        idempotencyKey: deploymentCommandKey(existing.id, existing.idempotencyKey),
      });
      const recovered = await prisma.deploymentRun.updateMany({
        where: { id: existing.id, teamId: existing.teamId, commandRequestId: null, AND: deploymentRunTeamWhere(session) },
        data: {
          commandRequestId: command.id,
          status: command.status === "PENDING_APPROVAL" ? "PENDING" : "RUNNING",
          completedAt: null,
          errorMessage: null,
        },
      });
      if (recovered.count === 0) {
        throw new NotFoundError(t("backend.deployment.deploymentRunNotFound"));
      }
      const recoveredRun = await prisma.deploymentRun.findFirst({
        where: { id: existing.id, ...deploymentRunTeamWhere(session) },
      });
      if (!recoveredRun) {
        throw new NotFoundError(t("backend.deployment.deploymentRunNotFound"));
      }
      return recoveredRun;
    }
  }

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.deploymentRun.create({
      data: {
      templateId: template.id,
      idempotencyKey,
      variables: normalized.variables,
      renderedCommand,
      serverIds: normalized.serverIds,
      createdBy: normalized.requesterId,
      status: "PENDING",
      teamId,
      },
    });

    const snapshot = await tx.deploymentSnapshot.create({
    data: {
      sourceRunId: created.id,
      templateId: template.id,
      templateName: template.name,
      deployCommand: renderedCommand,
      rollbackCommand: renderedRollbackCommand,
      variables: normalized.variables,
      serverIds: normalized.serverIds,
      createdBy: normalized.requesterId,
    },
    });
    return tx.deploymentRun.update({ where: { id: created.id }, data: { snapshotId: snapshot.id } });
  });

  try {
    // No session on createCommandRequest: stamp teamId from the DeploymentRun so the
    // spawned CommandRequest is not null-team (shared across all tenants in list views).
    const command = await submitDeploymentCommand({
      title: commandRequestTitle("Deployment: ", template.name),
      command: renderedCommand,
      reason: normalized.reason || "Deployment template triggered",
      submissionMode: "assistant",
      requesterId: normalized.requesterId,
      serverIds: normalized.serverIds,
      teamId,
      idempotencyKey: deploymentCommandKey(run.id, idempotencyKey),
    });
    // Awaited so a failed link write is settled below too: unawaited, it
    // escaped this catch and left the run PENDING and unlinked for good.
    return await prisma.deploymentRun.update({
      where: { id: run.id, teamId, commandRequestId: null },
      data: {
        commandRequestId: command.id,
        status: command.status === "PENDING_APPROVAL" ? "PENDING" : "RUNNING",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create command approval chain";
    // The command may exist although this failed (our link write failed, or
    // its creation committed but the reply was lost): link it instead of
    // reporting a deployment as failed while its command awaits approval or
    // runs.
    await linkOrFailDeploymentRun(run, message).catch(recoveryError => {
      if (recoveryError instanceof ConflictError) throw recoveryError;
    });
    throw error;
  }
}

async function submitDeploymentCommand(input: Parameters<typeof createCommandRequest>[0]) {
  const command = await createCommandRequest(input);
  if (command.initiatedByType !== "ASSISTANT" || command.requesterId !== input.requesterId ||
    command.teamId !== (input.teamId ?? null) || command.idempotencyKey !== input.idempotencyKey) {
    throw new ConflictError(t("backend.command.idempotencyKeyInUse"));
  }
  return command;
}

function deploymentCommandKey(runId: string, storedKey: string | null) {
  // Older requests used their scoped external key. All new command keys bind to the run ID.
  const legacy = storedKey && !storedKey.startsWith("v2:") ? "deployment:" + storedKey : null;
  // An oversized old command key could never have created a command.
  return legacy && legacy.length <= 300 ? legacy : "deployment:" + runId;
}

/**
 * Settle a run whose command creation or link was interrupted: link the
 * command carrying the run's key (the run takes its status), or, if none was
 * ever created, mark the run FAILED. Only unlinked runs are touched.
 */
type RecoveryRun = { id: string; teamId: string | null; createdBy: string | null; renderedCommand: string; idempotencyKey: string | null; serverIds: string[] };

function sameTargets(expected: string[], actual: string[]) {
  const wanted = new Set(expected);
  const found = new Set(actual);
  return wanted.size === found.size && [...wanted].every(id => found.has(id));
}

const recoveryCommandSelect = { id: true, status: true, targets: { select: { serverId: true } } } as const;

async function linkOrFailDeploymentRun(run: RecoveryRun, failureMessage: string) {
  const runId = run.id;
  const commandKey = deploymentCommandKey(runId, run.idempotencyKey);
  const command = run.createdBy ? await prisma.commandRequest.findUnique({
    where: { idempotencyKey: commandKey, teamId: run.teamId, initiatedByType: "ASSISTANT", requesterId: run.createdBy,
      command: run.renderedCommand, deploymentRuns: { none: { id: { not: runId } } }, deploymentRollbackRuns: { none: {} } },
    select: recoveryCommandSelect,
  }) : null;
  if (command && sameTargets(run.serverIds, command.targets.map(target => target.serverId))) {
    const resolved = resolveDeploymentRunStatus({
      id: runId,
      status: command.status === "PENDING_APPROVAL" ? "PENDING" : "RUNNING",
      commandRequest: { status: command.status },
    });
    await prisma.deploymentRun.updateMany({
      where: { id: runId, teamId: run.teamId, commandRequestId: null },
      data: {
        commandRequestId: command.id,
        status: resolved.status,
        errorMessage: resolved.errorMessage,
        completedAt: TERMINAL_DEPLOYMENT_STATUSES.has(resolved.status) ? new Date() : null,
      },
    });
    return;
  }
  const collision = command !== null || await prisma.commandRequest.count({ where: { idempotencyKey: commandKey } }) > 0;
  const message = collision ? t("backend.command.idempotencyKeyInUse") : failureMessage;
  await prisma.deploymentRun.updateMany({
    where: { id: runId, teamId: run.teamId, commandRequestId: null },
    data: { status: "FAILED", errorMessage: message.slice(0, 2000), completedAt: new Date() },
  });
  if (collision) throw new ConflictError(message);
}

/** A run still unlinked after this long lost its creating request. */
const UNLINKED_RUN_GRACE_MS = 5 * 60_000;

async function healUnlinkedDeploymentRuns(runs: Array<RecoveryRun & { status: string; commandRequestId: string | null; createdAt: Date }>) {
  const stale = runs.filter((run) => !run.commandRequestId && run.status === "PENDING" && Date.now() - run.createdAt.getTime() > UNLINKED_RUN_GRACE_MS);
  for (const run of stale) {
    await linkOrFailDeploymentRun(
      run,
      "Deployment was interrupted before its command was created; nothing was executed.",
    ).catch(() => undefined);
  }
  return stale.length > 0;
}

type DeploymentRunWithCommand = {
  id: string;
  status: string;
  errorMessage?: string | null;
  completedAt?: Date | null;
  commandRequest?: { status: string } | null;
};

const DEPLOYMENT_RUN_INCLUDE = {
  template: true,
  creator: { select: { username: true, displayName: true } },
  commandRequest: { select: { status: true } },
  snapshot: true,
  rollbackAttempts: {
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { commandRequest: { select: { status: true } } },
  },
} as const;

const TERMINAL_DEPLOYMENT_STATUSES = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "REJECTED",
]);

function resolveDeploymentRunStatus(run: DeploymentRunWithCommand) {
  const commandStatus = run.commandRequest?.status;
  if (!commandStatus)
    return { status: run.status, errorMessage: run.errorMessage ?? null };

  if (commandStatus === "REJECTED") {
    return {
      status: "REJECTED",
      errorMessage: run.errorMessage ?? "Associated command request has been rejected; deployment will not execute.",
    };
  }
  if (commandStatus === "FAILED" || commandStatus === "CANCELLED") {
    return {
      status: commandStatus,
      errorMessage:
        run.errorMessage ??
        `Associated command request has ${commandStatus === "FAILED" ? "failed" : "been cancelled"}.`,
    };
  }
  if (["RUNNING", "COMPLETED", "APPROVED"].includes(commandStatus)) {
    return {
      status: commandStatus === "APPROVED" ? "RUNNING" : commandStatus,
      errorMessage: run.errorMessage ?? null,
    };
  }
  return { status: run.status, errorMessage: run.errorMessage ?? null };
}

async function persistResolvedDeploymentRunStatus<
  T extends DeploymentRunWithCommand,
>(run: T) {
  const resolved = resolveDeploymentRunStatus(run);
  const shouldPersist =
    run.commandRequest?.status &&
    TERMINAL_DEPLOYMENT_STATUSES.has(resolved.status) &&
    (run.status !== resolved.status ||
      (resolved.errorMessage && run.errorMessage !== resolved.errorMessage) ||
      !run.completedAt);

  if (!shouldPersist) return { ...run, ...resolved };

  const updated = await prisma.deploymentRun.update({
    where: { id: run.id },
    data: {
      status: resolved.status,
      errorMessage: resolved.errorMessage,
      completedAt: run.status === resolved.status ? run.completedAt ?? new Date() : new Date(),
    },
    include: DEPLOYMENT_RUN_INCLUDE,
  });
  return { ...updated, ...resolveDeploymentRunStatus(updated) };
}

/** Previous releases could reattach a live command while keeping the failed attempt's timestamp. */
async function clearRecoveredCompletionTimes(runs: Array<DeploymentRunWithCommand & { rollbackAttempts?: RollbackRunWithCommand[] }>) {
  const activeCommands = ["PENDING_APPROVAL", "APPROVED", "RUNNING", "CANCELLING"] as const;
  const staleIds = (rows: DeploymentRunWithCommand[]) => rows.filter(row =>
    row.completedAt && !TERMINAL_DEPLOYMENT_STATUSES.has(row.status)
    && activeCommands.some(status => status === row.commandRequest?.status),
  ).map(row => row.id);
  const deployments = staleIds(runs);
  const rollbacks = staleIds(runs.flatMap(run => run.rollbackAttempts ?? []));
  if (!deployments.length && !rollbacks.length) return false;
  // A command can finish between the history read and this repair.
  const stillActive = { completedAt: { not: null }, status: { notIn: [...TERMINAL_DEPLOYMENT_STATUSES] },
    commandRequest: { is: { status: { in: [...activeCommands] } } } };
  if (deployments.length) await prisma.deploymentRun.updateMany({
    where: { id: { in: deployments }, ...stillActive }, data: { completedAt: null },
  });
  if (rollbacks.length) await prisma.deploymentRollbackRun.updateMany({
    where: { id: { in: rollbacks }, ...stillActive }, data: { completedAt: null },
  });
  return true;
}

export async function listDeploymentRuns(session: SessionScope,
  pagination?: { skip?: number; take?: number },) {
  const page = () => prisma.deploymentRun.findMany({
    where: deploymentRunTeamWhere(session),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(pagination?.skip ? { skip: pagination.skip } : {}),
    take: pagination?.take ?? 100,
    include: DEPLOYMENT_RUN_INCLUDE,
  });
  let runs = await page();
  // Runs whose command was created but never linked (or never created) are
  // settled here instead of showing "pending" forever.
  const repairedCompletion = await clearRecoveredCompletionTimes(runs);
  if (await healUnlinkedDeploymentRuns(runs) || repairedCompletion) runs = await page();
  await refreshDeploymentRollbackStatuses(runs.flatMap((run) => run.rollbackAttempts ?? []));
  return Promise.all(
    runs.map((run) =>
      persistResolvedDeploymentRunStatus({
        ...run,
        rollbackAttempts: (run.rollbackAttempts ?? []).map((rollback) => ({
          ...rollback,
          ...resolveRollbackRunStatus(rollback),
        })),
      }),
    ),
  );
}

type RollbackRunWithCommand = {
  id: string;
  status: string;
  errorMessage?: string | null;
  completedAt?: Date | null;
  commandRequest?: { status: string } | null;
};

function resolveRollbackRunStatus(run: RollbackRunWithCommand) {
  const commandStatus = run.commandRequest?.status;
  if (!commandStatus) return { status: run.status, errorMessage: run.errorMessage ?? null };
  if (commandStatus === "REJECTED") {
    return { status: "REJECTED", errorMessage: run.errorMessage ?? "Associated command request has been rejected; rollback will not execute." };
  }
  if (commandStatus === "FAILED" || commandStatus === "CANCELLED") {
    return {
      status: commandStatus,
      errorMessage: run.errorMessage ?? `Associated command request has ${commandStatus === "FAILED" ? "failed" : "been cancelled"}.`,
    };
  }
  if (["RUNNING", "COMPLETED", "APPROVED"].includes(commandStatus)) {
    return { status: commandStatus === "APPROVED" ? "RUNNING" : commandStatus, errorMessage: run.errorMessage ?? null };
  }
  return { status: run.status, errorMessage: run.errorMessage ?? null };
}

async function refreshDeploymentRollbackStatuses(runs: RollbackRunWithCommand[]) {
  await Promise.all(runs.map(async (run) => {
    const resolved = resolveRollbackRunStatus(run);
    const shouldPersist =
      run.commandRequest?.status &&
      TERMINAL_DEPLOYMENT_STATUSES.has(resolved.status) &&
      (run.status !== resolved.status || (resolved.errorMessage && run.errorMessage !== resolved.errorMessage) || !run.completedAt);
    if (!shouldPersist) return;
    await prisma.deploymentRollbackRun.update({
      where: { id: run.id },
      data: {
        status: resolved.status,
        errorMessage: resolved.errorMessage,
        completedAt: run.status === resolved.status ? run.completedAt ?? new Date() : new Date(),
      },
    });
  }));
}

const ACTIVE_ROLLBACK_STATUSES = new Set(["PENDING", "APPROVED", "RUNNING"]);

function rollbackCommandKey(rollbackId: string) {
  return `deployment-rollback:${rollbackId}`;
}

/**
 * Resolve a rollback whose command creation or link was interrupted. If a
 * command carries the rollback's key it is linked (and the rollback takes its
 * status); otherwise nothing was ever submitted and the rollback is retired as
 * FAILED. Callers must hold the per-source-run rollback lock.
 */
async function recoverUnlinkedRollback(rollback: { id: string; createdBy: string | null; rollbackCommand: string; serverIds: string[] }, teamId: string | null, failureMessage?: string) {
  const rollbackId = rollback.id;
  const where = { id: rollbackId, commandRequestId: null, sourceRun: { teamId } };
  const command = rollback.createdBy ? await prisma.commandRequest.findUnique({
    where: { idempotencyKey: rollbackCommandKey(rollbackId), teamId, initiatedByType: "ASSISTANT", requesterId: rollback.createdBy,
      command: rollback.rollbackCommand, deploymentRollbackRuns: { none: { id: { not: rollbackId } } }, deploymentRuns: { none: {} } },
    select: recoveryCommandSelect,
  }) : null;
  if (command && sameTargets(rollback.serverIds, command.targets.map(target => target.serverId))) {
    const resolved = resolveRollbackRunStatus({
      id: rollbackId,
      status: command.status === "PENDING_APPROVAL" ? "PENDING" : "RUNNING",
      commandRequest: { status: command.status },
    });
    return prisma.deploymentRollbackRun.update({
      where,
      data: {
        commandRequestId: command.id,
        status: resolved.status,
        errorMessage: resolved.errorMessage,
        completedAt: TERMINAL_DEPLOYMENT_STATUSES.has(resolved.status) ? new Date() : null,
      },
      select: { id: true, status: true },
    });
  }
  const collision = command !== null || await prisma.commandRequest.count({ where: { idempotencyKey: rollbackCommandKey(rollbackId) } }) > 0;
  const message = collision ? t("backend.command.idempotencyKeyInUse")
    : (failureMessage ?? "Rollback was interrupted before its command was created; nothing was executed.");
  const retired = await prisma.deploymentRollbackRun.update({
    where,
    data: {
      status: "FAILED",
      errorMessage: message.slice(0, 2000),
      completedAt: new Date(),
    },
    select: { id: true, status: true },
  });
  if (collision) throw new ConflictError(message);
  return retired;
}

export async function createDeploymentRollbackRun(
  input: { sourceRunId: string; requesterId: string; reason?: string },
  session: SessionScope,
) {
  const sourceRun = await getDeploymentRunForSession(input.sourceRunId, session, {
    snapshot: true,
    template: true,
  });
  if (!sourceRun) throw new NotFoundError(t("backend.deployment.deploymentRunNotFound"));
  const nonRollbackableStatuses = new Set(["PENDING", "APPROVED", "REJECTED", "CANCELLED", "RUNNING"]);
  if (sourceRun.status && nonRollbackableStatuses.has(sourceRun.status)) {
    throw new ValidationError(t("backend.deployment.rollbackRequiresExecutedRun"));
  }
  const snapshot = sourceRun.snapshot;
  if (!snapshot) throw new NotFoundError(t("backend.deployment.thisDeploymentHasNoSnapshotAvailableForRollback"));
  if (!snapshot.rollbackCommand?.trim()) throw new ValidationError(t("backend.deployment.thisDeploymentSnapshotHasNoRollbackCommand"));
  // The snapshot froze raw server ids at launch time. Re-check visibility (not
  // availability — a rollback is exactly what you run when a target is sick) so
  // a server that has since moved to another customer cannot be commanded through an old
  // run.
  if (Array.isArray(snapshot.serverIds) && snapshot.serverIds.length > 0) {
    await loadDeploymentServersInScope(snapshot.serverIds, session);
  }

  // Serialize concurrent rollback POSTs for the same source run.
  const releaseLock = await acquireAdvisoryLock("deployment-rollback", sourceRun.id);
  try {
    const activeRollbacks = await prisma.deploymentRollbackRun.findMany({
      where: {
        sourceRunId: sourceRun.id,
        status: { in: [...ACTIVE_ROLLBACK_STATUSES] },
      },
      select: { id: true, createdBy: true, rollbackCommand: true, serverIds: true, status: true, errorMessage: true, completedAt: true, commandRequestId: true, commandRequest: { select: { status: true } } },
      orderBy: { createdAt: "desc" },
    });
    // A rollback's own status only catches up with its command when the list
    // is read: a rollback whose command had finished still blocked a new one
    // until someone reloaded the page. Settle it from the command first.
    await refreshDeploymentRollbackStatuses(activeRollbacks.filter((active) => active.commandRequestId));
    for (const active of activeRollbacks) {
      // We hold the per-run lock, so no request is still creating this
      // rollback's command: an unlinked one was interrupted. Resolve it from
      // its command key instead of letting it block every future rollback.
      const status = active.commandRequestId ? resolveRollbackRunStatus(active).status : (await recoverUnlinkedRollback(active, sourceRun.teamId)).status;
      if (ACTIVE_ROLLBACK_STATUSES.has(status)) {
        throw new ConflictError(t("backend.deployment.aRollbackTaskIsAlreadyInProgressPlease"));
      }
    }

    const reason = input.reason?.trim() || `Rollback: ${snapshot.templateName}`;
    const rollbackTeamId = sourceRun.teamId ?? null;
    const rollback = await prisma.deploymentRollbackRun.create({
      data: {
        sourceRunId: sourceRun.id,
        snapshotId: snapshot.id,
        rollbackCommand: snapshot.rollbackCommand,
        serverIds: snapshot.serverIds,
        reason,
        createdBy: input.requesterId,
        status: "PENDING",
      },
    });

    try {
      // Propagate parent DeploymentRun.teamId onto the CommandRequest (system path, no session).
      const command = await submitDeploymentCommand({
        title: commandRequestTitle("Rollback deployment: ", snapshot.templateName),
        command: snapshot.rollbackCommand,
        reason,
        submissionMode: "assistant",
        requesterId: input.requesterId,
        serverIds: snapshot.serverIds,
        teamId: rollbackTeamId,
        // Stable link from the rollback to its command: recovery finds the
        // command by this key if the link below is never written.
        idempotencyKey: rollbackCommandKey(rollback.id),
      });

      return await prisma.deploymentRollbackRun.update({
        where: { id: rollback.id, commandRequestId: null, sourceRun: { teamId: rollbackTeamId } },
        data: {
          commandRequestId: command.id,
          status: command.status === "PENDING_APPROVAL" ? "PENDING" : "RUNNING",
        },
        include: { commandRequest: { select: { status: true } }, snapshot: true },
      });
    } catch (error) {
      // The command may exist although this call failed (created, then the
      // link failed). Marking the rollback FAILED would then allow a second
      // rollback to run the same command again: link it if it exists, retire
      // it only if it was never created. If even that fails the row stays
      // PENDING and the next rollback request recovers it under the lock.
      const errMsg = error instanceof Error ? error.message : String(error);
      await recoverUnlinkedRollback(rollback, rollbackTeamId, errMsg).catch(recoveryError => {
        if (recoveryError instanceof ConflictError) throw recoveryError;
        // A transient bookkeeping failure can be recovered by the next request.
      });
      throw error;
    }
  } finally {
    await releaseLock();
  }
}
