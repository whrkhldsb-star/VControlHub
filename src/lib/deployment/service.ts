import { prisma } from "@/lib/db";
import { createCommandRequest } from "@/lib/command/service";
import { renderCommand, seedBuiltinTemplates } from "@/lib/command-template/service";
import type { SessionPayload } from "@/lib/auth/session";
import { teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";

// TR-039: pure DTO types live in ./dto so client code can reach them
// without pulling the whole server-only service module. We import them
// for in-file use AND re-export them so every existing call site
// 'from "@/lib/deployment/service"' keeps working.
import type {
  DeploymentLaunchInputDto,
  DeploymentRollbackInputDto,
  DeploymentRollbackRunDto,
  DeploymentRunDto,
  DeploymentSnapshotDto,
  DeploymentStatusDto,
  DeploymentTemplateDto,
} from "./dto";

export type {
  DeploymentLaunchInputDto,
  DeploymentRollbackInputDto,
  DeploymentRollbackRunDto,
  DeploymentRunDto,
  DeploymentSnapshotDto,
  DeploymentStatusDto,
  DeploymentTemplateDto,
};

export type SessionScope = Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;

function teamScopeWhere(session?: SessionScope | null): Record<string, unknown> {
  return session ? teamWhere(session) : {};
}

/**
 * Load a deployment run by id under optional team scope.
 * Mutate paths (rollback) use this so cross-team IDs resolve as not-found (no IDOR).
 */
async function getDeploymentRunForSession(
  id: string,
  session?: SessionScope | null,
  include?: {
    snapshot?: boolean;
    template?: boolean;
  },
) {
  return prisma.deploymentRun.findFirst({
    where: { id, ...teamScopeWhere(session) },
    include: {
      snapshot: include?.snapshot ?? false,
      template: include?.template ?? false,
    },
  });
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
  if (!templateId) throw new ValidationError("Deployment template is required");
  if (!requesterId) throw new ValidationError("Requester is required");
  if (serverIds.length < 1) throw new ValidationError("At least 1 target VPS must be selected");
  if (reason && reason.length > 500) throw new ValidationError("Reason must be at most 500 characters");
  return { ...input, templateId, requesterId, serverIds, reason };
}

function assertTemplateVariables(
  command: string,
  templateVariables: string[] | null | undefined,
  variables: Record<string, string>,
) {
  const placeholders = Array.from(
    command.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g),
  ).map((match) => match[1]!);
  const required = Array.from(
    new Set([
      ...(Array.isArray(templateVariables) ? templateVariables : []),
      ...placeholders,
    ]),
  ).filter(Boolean);
  const missing = required.filter((name) => !variables[name]?.trim());
  if (missing.length > 0)
    throw new ValidationError(`Deployment template variables not fully filled in: ${missing.join(", ")}`);
}

export async function listDeploymentTemplates() {
  await seedBuiltinTemplates();
  return prisma.commandTemplate.findMany({ orderBy: [{ isBuiltin: "desc" }, { name: "asc" }], take: 200 });
}

export async function createDeploymentRunFromTemplate(
  input: {
    templateId: string;
    serverIds: string[];
    variables: Record<string, string>;
    requesterId: string;
    reason?: string;
  },
  session?: SessionScope | null,
) {
  const normalized = normalizeDeploymentInput(input);
  const template = await prisma.commandTemplate.findUnique({
    where: { id: normalized.templateId },
  });
  if (!template) throw new NotFoundError("Deployment template not found");
  assertTemplateVariables(
    template.command,
    template.variables,
    normalized.variables,
  );
  const renderedCommand = renderCommand(template.command, normalized.variables);
  const renderedRollbackCommand = template.rollbackCommand
    ? renderCommand(template.rollbackCommand, normalized.variables)
    : null;

  const teamId = session ? (teamCreateData(session).teamId ?? null) : null;

  const run = await prisma.deploymentRun.create({
    data: {
      templateId: template.id,
      variables: normalized.variables,
      renderedCommand,
      serverIds: normalized.serverIds,
      createdBy: normalized.requesterId,
      status: "PENDING",
      teamId,
    },
  });

  const snapshot = await prisma.deploymentSnapshot.create({
    data: {
      sourceRunId: run.id,
      templateId: template.id,
      templateName: template.name,
      deployCommand: renderedCommand,
      rollbackCommand: renderedRollbackCommand,
      variables: normalized.variables,
      serverIds: normalized.serverIds,
      createdBy: normalized.requesterId,
    },
  });
  await prisma.deploymentRun.update({ where: { id: run.id }, data: { snapshotId: snapshot.id } });

  try {
    // No session on createCommandRequest: stamp teamId from the DeploymentRun so the
    // spawned CommandRequest is not null-team (shared across all tenants in list views).
    const command = await createCommandRequest({
      title: `Deployment: ${template.name}`,
      command: renderedCommand,
      reason: normalized.reason || "Deployment template triggered",
      submissionMode: "assistant",
      requesterId: normalized.requesterId,
      serverIds: normalized.serverIds,
      teamId,
    });
    return prisma.deploymentRun.update({
      where: { id: run.id },
      data: {
        commandRequestId: command.id,
        status: command.status === "PENDING_APPROVAL" ? "PENDING" : "RUNNING",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create command approval chain";
    await prisma.deploymentRun.update({
      where: { id: run.id },
      data: { status: "FAILED", errorMessage: message },
    });
    throw error;
  }
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
      completedAt: run.completedAt ?? new Date(),
    },
    include: DEPLOYMENT_RUN_INCLUDE,
  });
  return { ...updated, ...resolveDeploymentRunStatus(updated) };
}

export async function listDeploymentRuns(session?: SessionScope | null) {
  const runs = await prisma.deploymentRun.findMany({
    where: teamScopeWhere(session),
    orderBy: { createdAt: "desc" },
    take: 100,
    include: DEPLOYMENT_RUN_INCLUDE,
  });
  await refreshDeploymentRollbackStatuses(runs.flatMap((run) => run.rollbackAttempts ?? []));
  return Promise.all(
    runs.map((run) => persistResolvedDeploymentRunStatus(run)),
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
        completedAt: run.completedAt ?? new Date(),
      },
    });
  }));
}

export async function createDeploymentRollbackRun(
  input: { sourceRunId: string; requesterId: string; reason?: string },
  session?: SessionScope | null,
) {
  const sourceRun = await getDeploymentRunForSession(input.sourceRunId, session, {
    snapshot: true,
    template: true,
  });
  if (!sourceRun) throw new NotFoundError("Deployment run not found");
  const snapshot = sourceRun.snapshot;
  if (!snapshot) throw new NotFoundError("This deployment has no snapshot available for rollback");
  if (!snapshot.rollbackCommand?.trim()) throw new ValidationError("This deployment snapshot has no rollback command");

  const activeRollback = await prisma.deploymentRollbackRun.findFirst({
    where: {
      sourceRunId: sourceRun.id,
      status: { in: ["PENDING", "APPROVED", "RUNNING"] },
    },
    select: { id: true, status: true },
    orderBy: { createdAt: "desc" },
  });
  if (activeRollback) throw new ConflictError("A rollback task is already in progress; please wait for the current rollback to complete before retrying");

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

  // Propagate parent DeploymentRun.teamId onto the CommandRequest (system path, no session).
  const command = await createCommandRequest({
    title: `Rollback deployment: ${snapshot.templateName}`,
    command: snapshot.rollbackCommand,
    reason,
    submissionMode: "assistant",
    requesterId: input.requesterId,
    serverIds: snapshot.serverIds,
    teamId: rollbackTeamId,
  });

  return prisma.deploymentRollbackRun.update({
    where: { id: rollback.id },
    data: {
      commandRequestId: command.id,
      status: command.status === "PENDING_APPROVAL" ? "PENDING" : "RUNNING",
    },
    include: { commandRequest: { select: { status: true } }, snapshot: true },
  });
}
