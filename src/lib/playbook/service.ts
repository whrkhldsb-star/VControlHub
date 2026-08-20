/**
 * TR-023 M04: Playbook service — CRUD + chain execution entry point.
 *
 * Pattern mirrors `command-template/service.ts`: thin Prisma wrapper that
 * returns narrowed `PlaybookRecord` / `PlaybookRunRecord` shapes so callers
 * (UI, API routes, executor) never have to re-parse the `triggerConfig`
 * or `steps` JSON columns.
 */

import { Prisma } from "@prisma/client";
import { assertUserInActorScope, serverTeamWhere, teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import type { SessionPayload } from "@/lib/auth/session";

import { prisma } from "@/lib/db";
import { auditUserAction } from "@/lib/audit/service";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { NotFoundError, ValidationError, BusinessError } from "@/lib/errors";

import type {
  CreatePlaybookInput,
  UpdatePlaybookInput,
} from "./schema";
import { t } from "@/lib/i18n/service-translations";
import type {
  PlaybookRecord,
  PlaybookRunRecord,
  PlaybookStep,
  PlaybookStepResult,
  TriggerConfig,
  TriggerType,
} from "./types";
import {
  assertValidPlaybookTriggerConfig,
  computeNextPlaybookCronRun,
  isCronTriggerConfig,
  normalizePlaybookCronExpression,
} from "./trigger-utils";
import { queuePlaybookRunWithClient } from "./run-queue";

type TeamSession = Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;

/**
 * Reject playbook steps that target servers outside the caller's team.
 * Defense-in-depth: executor also scopes createCommandRequest by teamId,
 * but validation at write-time prevents storing an IDOR payload that would
 * later fail (or worse, succeed under a stale null teamId stamp).
 */
async function assertPlaybookCommandServersInScope(
  steps: PlaybookStep[],
  session?: TeamSession | null,
): Promise<void> {
  const serverIds = [
    ...new Set(
      steps
        .filter((step): step is Extract<PlaybookStep, { type: "run_command" }> => step.type === "run_command")
        .flatMap((step) => step.config.serverIds),
    ),
  ];
  if (serverIds.length === 0) return;

  const scope = session ? serverTeamWhere(session) : {};
  const servers = await prisma.server.findMany({
    where: { id: { in: serverIds }, ...scope },
    select: { id: true },
  });
  if (servers.length !== serverIds.length) {
    throw new ValidationError(
      "One or more playbook command targets were not found or are outside your team scope",
    );
  }
}

/**
 * Reject send_notification recipients outside the caller's user directory scope.
 * Without this, a team playbook author can store any userId and the worker will
 * create cross-tenant inbox rows (notification IDOR).
 */
async function assertPlaybookNotificationRecipientsInScope(
  steps: PlaybookStep[],
  session?: TeamSession | null,
): Promise<void> {
  if (!session) return;
  const recipientIds = [
    ...new Set(
      steps
        .filter(
          (step): step is Extract<PlaybookStep, { type: "send_notification" }> =>
            step.type === "send_notification",
        )
        .map((step) => step.config.recipientUserId)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0),
    ),
  ];
  for (const recipientUserId of recipientIds) {
    try {
      await assertUserInActorScope(session, recipientUserId);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new ValidationError(
          "One or more playbook notification recipients were not found or are outside your team scope",
        );
      }
      throw error;
    }
  }
}

async function assertPlaybookStepsInScope(
  steps: PlaybookStep[],
  session?: TeamSession | null,
): Promise<void> {
  await assertPlaybookCommandServersInScope(steps, session);
  await assertPlaybookNotificationRecipientsInScope(steps, session);
}

type RawPlaybook = {
  id: string;
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: unknown;
  steps: unknown;
  chainRetry: number;
  enabled: boolean;
  nextRunAt: Date | null;
  lastTriggeredAt: Date | null;
  metricMatchState: unknown;
  createdById: string | null;
  teamId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type RawPlaybookRun = {
  id: string;
  playbookId: string;
  status: string;
  dryRun: boolean;
  triggerContext: unknown;
  triggerKey: string | null;
  stepResults: unknown;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function narrowPlaybook(row: RawPlaybook): PlaybookRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    triggerType: row.triggerType as TriggerType,
    triggerConfig: row.triggerConfig as TriggerConfig,
    steps: row.steps as PlaybookStep[],
    chainRetry: row.chainRetry,
    enabled: row.enabled,
    nextRunAt: row.nextRunAt,
    lastTriggeredAt: row.lastTriggeredAt,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function narrowPlaybookRun(row: RawPlaybookRun): PlaybookRunRecord {
  return {
    id: row.id,
    playbookId: row.playbookId,
    status: row.status as PlaybookRunRecord["status"],
    dryRun: row.dryRun,
    triggerContext: row.triggerContext,
    triggerKey: row.triggerKey,
    stepResults: (row.stepResults ?? []) as PlaybookStepResult[],
    errorMessage: row.errorMessage,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listPlaybooks(session?: TeamSession): Promise<PlaybookRecord[]> {
  const where = session ? { ...teamWhere(session) } : {};
  const rows = await prisma.playbook.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500, // P2: playbook 总数有限
  });
  return rows.map(narrowPlaybook);
}

export async function getPlaybook(
  id: string,
  session?: TeamSession | null,
): Promise<PlaybookRecord | null> {
  const row = session
    ? await prisma.playbook.findFirst({ where: { id, ...teamWhere(session) } })
    : await prisma.playbook.findUnique({ where: { id } });
  return row ? narrowPlaybook(row) : null;
}

export async function createPlaybook(
  input: CreatePlaybookInput,
  createdById: string,
  session?: TeamSession | null,
): Promise<PlaybookRecord> {
  await assertPlaybookStepsInScope(input.steps as PlaybookStep[], session);
  try {
    assertValidPlaybookTriggerConfig(input.triggerType, input.triggerConfig);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : String(error));
  }
  const triggerConfig = input.triggerType === "cron" && isCronTriggerConfig(input.triggerConfig)
    ? { expression: normalizePlaybookCronExpression(input.triggerConfig.expression) }
    : input.triggerConfig;
  const nextRunAt = input.enabled && input.triggerType === "cron" && isCronTriggerConfig(triggerConfig)
    ? computeNextPlaybookCronRun(triggerConfig.expression)
    : null;
  const teamData = session ? teamCreateData(session) : {};
  const row = await prisma.playbook.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      triggerType: input.triggerType,
      triggerConfig: triggerConfig as unknown as Prisma.InputJsonValue,
      steps: input.steps as unknown as Prisma.InputJsonValue,
      chainRetry: input.chainRetry,
      enabled: input.enabled,
      nextRunAt,
      createdById,
      ...teamData,
    },
  });
  const narrowed = narrowPlaybook(row);
  await auditUserAction(createdById, "playbook.create", {
    playbookId: narrowed.id,
    name: narrowed.name,
    triggerType: narrowed.triggerType,
    stepCount: narrowed.steps.length,
    chainRetry: narrowed.chainRetry,
  });
  return narrowed;
}

export async function updatePlaybook(
  input: UpdatePlaybookInput,
  updatedById: string,
  session?: TeamSession | null,
): Promise<PlaybookRecord> {
  const { id, ...rest } = input;
  const releaseLock = await acquireAdvisoryLock("playbook-lifecycle", id);
  let narrowed: PlaybookRecord;
  try {
    const existing = await getPlaybook(id, session);
    if (!existing) throw new NotFoundError(t("backend.playbook.notFound"));
    if (rest.steps !== undefined) {
      await assertPlaybookStepsInScope(rest.steps as PlaybookStep[], session);
    }

    const effectiveTriggerType = rest.triggerType ?? existing.triggerType;
    const effectiveTriggerConfig = (rest.triggerConfig ?? existing.triggerConfig) as TriggerConfig;
    const triggerChanged = rest.triggerType !== undefined || rest.triggerConfig !== undefined;
    if (triggerChanged) {
      try {
        assertValidPlaybookTriggerConfig(effectiveTriggerType, effectiveTriggerConfig);
      } catch (error) {
        throw new ValidationError(error instanceof Error ? error.message : String(error));
      }
    }
    const normalizedTriggerConfig = triggerChanged && effectiveTriggerType === "cron" && isCronTriggerConfig(effectiveTriggerConfig)
      ? { expression: normalizePlaybookCronExpression(effectiveTriggerConfig.expression) }
      : effectiveTriggerConfig;
    const effectiveEnabled = rest.enabled ?? existing.enabled;

    const data: Prisma.PlaybookUpdateInput = {};
    if (rest.name !== undefined) data.name = rest.name;
    if (rest.description !== undefined) data.description = rest.description;
    if (rest.triggerType !== undefined) data.triggerType = rest.triggerType;
    if (rest.triggerConfig !== undefined) {
      data.triggerConfig = normalizedTriggerConfig as unknown as Prisma.InputJsonValue;
    }
    if (rest.steps !== undefined) {
      data.steps = rest.steps as unknown as Prisma.InputJsonValue;
    }
    if (rest.chainRetry !== undefined) data.chainRetry = rest.chainRetry;
    if (rest.enabled !== undefined) data.enabled = rest.enabled;
    if (triggerChanged || rest.enabled !== undefined) {
      data.nextRunAt = effectiveEnabled && effectiveTriggerType === "cron" && isCronTriggerConfig(normalizedTriggerConfig)
        ? computeNextPlaybookCronRun(normalizedTriggerConfig.expression)
        : null;
    }
    if (triggerChanged) data.metricMatchState = Prisma.DbNull;
    const row = await prisma.playbook.update({ where: { id }, data });
    narrowed = narrowPlaybook(row);
  } finally {
    await releaseLock();
  }
  await auditUserAction(updatedById, "playbook.update", {
    playbookId: narrowed.id,
    name: narrowed.name,
    enabled: narrowed.enabled,
    stepCount: narrowed.steps.length,
  });
  return narrowed;
}

export async function deletePlaybook(
  id: string,
  deletedById: string,
  session?: TeamSession | null,
): Promise<void> {
  const releaseLock = await acquireAdvisoryLock("playbook-lifecycle", id);
  try {
    const existing = await getPlaybook(id, session);
    if (!existing) throw new NotFoundError(t("backend.playbook.notFound"));
    // PlaybookRun statuses are lowercase: queued | running | completed | failed | cancelled
    const activeRun = await prisma.playbookRun.findFirst({
      where: { playbookId: id, status: { in: ["queued", "running"] } },
      select: { id: true },
    });
    if (activeRun) {
      throw new BusinessError(t("backend.playbook.cannotDeleteWhileRunning"));
    }
    await prisma.playbook.delete({ where: { id } });
  } finally {
    await releaseLock();
  }
  await auditUserAction(deletedById, "playbook.delete", { playbookId: id });
}

export async function listPlaybookRuns(
  playbookId: string,
  session?: TeamSession,
): Promise<PlaybookRunRecord[]> {
  // Ensure the parent playbook itself is in scope before leaking run history.
  if (session) {
    const playbook = await getPlaybook(playbookId, session);
    if (!playbook) throw new NotFoundError(t("backend.playbook.notFound"));
  }
  const rows = await prisma.playbookRun.findMany({
    where: { playbookId, ...(session ? teamWhere(session) : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map(narrowPlaybookRun);
}

/**
 * Persist a queued run and enqueue the durable parent job. The API returns
 * immediately; the playbook worker owns execution, retries and recovery.
 */
/** Batch-load recent runs for many playbooks (avoids N+1 getPlaybook+findMany). */
export async function listRecentPlaybookRunsForPlaybooks(
  playbookIds: string[],
  session?: TeamSession,
  perPlaybook = 5,
): Promise<Record<string, PlaybookRunRecord[]>> {
  const out: Record<string, PlaybookRunRecord[]> = {};
  for (const id of playbookIds) out[id] = [];
  if (playbookIds.length === 0) return out;
  // Over-fetch then group so each playbook still gets up to `perPlaybook` rows
  // without a correlated subquery per id.
  const take = Math.min(Math.max(playbookIds.length * perPlaybook, perPlaybook), 500);
  const rows = await prisma.playbookRun.findMany({
    where: {
      playbookId: { in: playbookIds },
      ...(session ? teamWhere(session) : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
  });
  for (const row of rows) {
    const list = out[row.playbookId] ?? (out[row.playbookId] = []);
    if (list.length >= perPlaybook) continue;
    list.push(narrowPlaybookRun(row));
  }
  return out;
}

export async function runPlaybook(input: {
  playbookId: string;
  dryRun: boolean;
  triggerContext?: unknown;
  createdById?: string;
  session?: TeamSession;
}): Promise<PlaybookRunRecord> {
  const releaseLock = await acquireAdvisoryLock("playbook-lifecycle", input.playbookId);
  let narrowedPlaybook: PlaybookRecord;
  let run: RawPlaybookRun;
  try {
    const scope = input.session ? teamWhere(input.session) : {};
    const playbook = await prisma.playbook.findFirst({
      where: { id: input.playbookId, ...scope },
    });
    if (!playbook) {
      throw new NotFoundError(
        t("backend.playbook.notFoundWithId", { id: input.playbookId }),
      );
    }
    narrowedPlaybook = narrowPlaybook(playbook);
    if (!narrowedPlaybook.enabled) {
      throw new BusinessError(
        t("backend.playbook.disabledWithId", { id: input.playbookId }),
      );
    }

    const queued = await prisma.$transaction((tx) =>
      queuePlaybookRunWithClient({
        client: tx,
        playbook: {
          id: playbook.id,
          name: playbook.name,
          steps: narrowedPlaybook.steps,
          chainRetry: playbook.chainRetry,
          createdById: playbook.createdById,
          teamId: playbook.teamId ?? null,
        },
        dryRun: input.dryRun,
        triggerContext: input.triggerContext,
        createdById: input.createdById ?? null,
      }),
    );
    run = queued.run;
  } finally {
    await releaseLock();
  }

  if (input.createdById) {
    await auditUserAction(input.createdById, input.dryRun ? "playbook.dry-run" : "playbook.run", {
      playbookId: input.playbookId,
      runId: run.id,
      dryRun: input.dryRun,
      status: "queued",
      stepCount: narrowedPlaybook.steps.length,
    });
  }
  return narrowPlaybookRun(run);
}
