import { prisma } from "@/lib/db";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { createCommandRequest } from "@/lib/command/service";
import { commandTemplateScopeWhere, renderCommand, seedBuiltinTemplates } from "@/lib/command-template/service";
import type { SessionPayload } from "@/lib/auth/session";
import { serverTeamWhere, teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";

// TR-039: pure DTO types live in ./dto so client code can reach them
// without pulling the whole server-only service module. We import them
// for in-file use AND re-export them so every existing call site
// 'from "@/lib/deployment/service"' keeps working.
import { t } from "@/lib/i18n/service-translations";
import { getServerTargetAvailability } from "@/lib/server/availability";
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


async function assertDeploymentServersInScope(
  serverIds: string[],
  session?: SessionScope | null,
): Promise<void> {
  if (serverIds.length === 0) return;
  // Prefer session teamWhere; when no session, skip (system/unscoped callers).
  if (!session) return;
  const scope = serverTeamWhere(session);
  const servers = await prisma.server.findMany({
    where: { id: { in: serverIds }, ...scope },
    select: {
      id: true,
      enabled: true,
      onboardingStatus: true,
      metricSnapshots: { select: { isOnline: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (servers.length !== serverIds.length) {
    throw new ValidationError(
      "One or more target servers were not found or are outside your team scope",
    );
  }
  if (servers.some((server) => server.enabled === false || !getServerTargetAvailability({
    onboardingStatus: server.onboardingStatus,
    latestMetric: server.metricSnapshots?.[0] ?? null,
  }).available)) {
    throw new ValidationError(t("backend.deployment.targetUnavailable"));
  }
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
  const missing = required.filter((name) => !variables[name]?.trim());
  if (missing.length > 0)
    throw new ValidationError(`Deployment template variables not fully filled in: ${missing.join(", ")}`);
}

export async function listDeploymentTemplates(session?: SessionScope | null) {
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
  session?: SessionScope | null,
) {
	const rawIdempotencyKey = input.idempotencyKey?.trim() || null;
	const idempotencyScope = session?.currentTeamId
		? `team:${session.currentTeamId}`
		: `user:${session?.userId ?? input.requesterId.trim()}`;
	const idempotencyKey = rawIdempotencyKey
		? `${idempotencyScope}:${rawIdempotencyKey}`
		: null;
	if (!idempotencyKey) return createDeploymentRunFromTemplateUnlocked(input, session);
	const release = await acquireAdvisoryLock("deployment", `create:${idempotencyKey}`);
	try {
		return await createDeploymentRunFromTemplateUnlocked({ ...input, idempotencyKey }, session);
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
	session?: SessionScope | null,
) {
  const normalized = normalizeDeploymentInput(input);
  await assertDeploymentServersInScope(normalized.serverIds, session);
  const template = session
		? await prisma.commandTemplate.findFirst({ where: { id: normalized.templateId, ...commandTemplateScopeWhere(session) } })
		: await prisma.commandTemplate.findUnique({ where: { id: normalized.templateId } });
  if (!template) throw new NotFoundError(t("backend.deployment.deploymentTemplateNotFound"));
  assertTemplateVariables(
    template.command,
    template.variables,
    normalized.variables,
    template.rollbackCommand,
  );
  const renderedCommand = renderCommand(template.command, normalized.variables);
  const renderedRollbackCommand = template.rollbackCommand
    ? renderCommand(template.rollbackCommand, normalized.variables)
    : null;

  const teamId = session ? (teamCreateData(session).teamId ?? null) : null;
	const idempotencyKey = input.idempotencyKey?.trim() || null;
	if (idempotencyKey) {
		const existing = await prisma.deploymentRun.findFirst({
			where: { idempotencyKey, ...teamScopeWhere(session) },
		});
		if (existing) {
			if (existing.commandRequestId) return existing;
			const command = await createCommandRequest({
				title: `Deployment: ${template.name}`,
				command: existing.renderedCommand,
				reason: normalized.reason || "Recovered deployment request",
				submissionMode: "assistant",
				requesterId: normalized.requesterId,
				serverIds: existing.serverIds,
				teamId: existing.teamId,
				idempotencyKey: `deployment:${idempotencyKey}`,
			});
			return prisma.deploymentRun.update({
				where: { id: existing.id },
				data: {
					commandRequestId: command.id,
					status: command.status === "PENDING_APPROVAL" ? "PENDING" : "RUNNING",
					errorMessage: null,
				},
			});
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
    const command = await createCommandRequest({
      title: `Deployment: ${template.name}`,
      command: renderedCommand,
      reason: normalized.reason || "Deployment template triggered",
      submissionMode: "assistant",
      requesterId: normalized.requesterId,
      serverIds: normalized.serverIds,
		teamId,
		idempotencyKey: `deployment:${idempotencyKey ?? run.id}`,
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
  if (!sourceRun) throw new NotFoundError(t("backend.deployment.deploymentRunNotFound"));
  const snapshot = sourceRun.snapshot;
  if (!snapshot) throw new NotFoundError(t("backend.deployment.thisDeploymentHasNoSnapshotAvailableForRollback"));
  if (!snapshot.rollbackCommand?.trim()) throw new ValidationError(t("backend.deployment.thisDeploymentSnapshotHasNoRollbackCommand"));

  // Serialize concurrent rollback POSTs for the same source run.
  const releaseLock = await acquireAdvisoryLock("deployment-rollback", sourceRun.id);
  try {
    const activeRollback = await prisma.deploymentRollbackRun.findFirst({
      where: {
        sourceRunId: sourceRun.id,
        status: { in: ["PENDING", "APPROVED", "RUNNING"] },
      },
      select: { id: true, status: true },
      orderBy: { createdAt: "desc" },
    });
    if (activeRollback) throw new ConflictError(t("backend.deployment.aRollbackTaskIsAlreadyInProgressPlease"));

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
      const command = await createCommandRequest({
        title: `Rollback deployment: ${snapshot.templateName}`,
        command: snapshot.rollbackCommand,
        reason,
        submissionMode: "assistant",
        requesterId: input.requesterId,
        serverIds: snapshot.serverIds,
        teamId: rollbackTeamId,
      });

      return await prisma.deploymentRollbackRun.update({
        where: { id: rollback.id },
        data: {
          commandRequestId: command.id,
          status: command.status === "PENDING_APPROVAL" ? "PENDING" : "RUNNING",
        },
        include: { commandRequest: { select: { status: true } }, snapshot: true },
      });
    } catch (error) {
      // Avoid orphan PENDING with null commandRequestId permanently blocking new rollbacks.
      const errMsg = error instanceof Error ? error.message : String(error);
      await prisma.deploymentRollbackRun
        .update({
          where: { id: rollback.id },
          data: {
            status: "FAILED",
            errorMessage: errMsg.slice(0, 2000),
            completedAt: new Date(),
          },
        })
        .catch(() => {
          /* best-effort compensation */
        });
      throw error;
    }
  } finally {
    await releaseLock();
  }
}
