/**
 * TR-023 M04: Playbook service — CRUD + chain execution entry point.
 *
 * Pattern mirrors `command-template/service.ts`: thin Prisma wrapper that
 * returns narrowed `PlaybookRecord` / `PlaybookRunRecord` shapes so callers
 * (UI, API routes, executor) never have to re-parse the `triggerConfig`
 * or `steps` JSON columns.
 */

import { Prisma } from "@prisma/client";
import { teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import type { SessionPayload } from "@/lib/auth/session";

import { prisma } from "@/lib/db";
import { auditUserAction } from "@/lib/audit/service";
import { NotFoundError } from "@/lib/errors";

import type {
  CreatePlaybookInput,
  UpdatePlaybookInput,
} from "./schema";
import type {
  PlaybookRecord,
  PlaybookRunRecord,
  PlaybookStep,
  PlaybookStepResult,
  TriggerConfig,
  TriggerType,
} from "./types";

type TeamSession = Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;

type RawPlaybook = {
  id: string;
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: unknown;
  steps: unknown;
  chainRetry: number;
  enabled: boolean;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type RawPlaybookRun = {
  id: string;
  playbookId: string;
  status: string;
  dryRun: boolean;
  triggerContext: unknown;
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
  const teamData = session ? teamCreateData(session) : {};
  const row = await prisma.playbook.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      triggerType: input.triggerType,
      triggerConfig: input.triggerConfig as unknown as Prisma.InputJsonValue,
      steps: input.steps as unknown as Prisma.InputJsonValue,
      chainRetry: input.chainRetry,
      enabled: input.enabled,
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
  const existing = await getPlaybook(id, session);
  if (!existing) throw new NotFoundError("Playbook not found");
  const data: Prisma.PlaybookUpdateInput = {};
  if (rest.name !== undefined) data.name = rest.name;
  if (rest.description !== undefined) data.description = rest.description;
  if (rest.triggerType !== undefined) data.triggerType = rest.triggerType;
  if (rest.triggerConfig !== undefined) {
    data.triggerConfig = rest.triggerConfig as unknown as Prisma.InputJsonValue;
  }
  if (rest.steps !== undefined) {
    data.steps = rest.steps as unknown as Prisma.InputJsonValue;
  }
  if (rest.chainRetry !== undefined) data.chainRetry = rest.chainRetry;
  if (rest.enabled !== undefined) data.enabled = rest.enabled;
  const row = await prisma.playbook.update({ where: { id }, data });
  const narrowed = narrowPlaybook(row);
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
  const existing = await getPlaybook(id, session);
  if (!existing) throw new NotFoundError("Playbook not found");
  await prisma.playbook.delete({ where: { id } });
  await auditUserAction(deletedById, "playbook.delete", { playbookId: id });
}

export async function listPlaybookRuns(
  playbookId: string,
  session?: TeamSession,
): Promise<PlaybookRunRecord[]> {
  // Ensure the parent playbook itself is in scope before leaking run history.
  if (session) {
    const playbook = await getPlaybook(playbookId, session);
    if (!playbook) throw new NotFoundError("Playbook not found");
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
export async function runPlaybook(input: {
  playbookId: string;
  dryRun: boolean;
  triggerContext?: unknown;
  createdById?: string;
  session?: TeamSession;
}): Promise<PlaybookRunRecord> {
  const scope = input.session ? teamWhere(input.session) : {};
  const playbook = await prisma.playbook.findFirst({
    where: { id: input.playbookId, ...scope },
  });
  if (!playbook) throw new NotFoundError(`playbook not found: ${input.playbookId}`);
  const narrowedPlaybook = narrowPlaybook(playbook);
  if (!narrowedPlaybook.enabled) throw new Error(`playbook is disabled: ${input.playbookId}`);

  const teamData = input.session ? teamCreateData(input.session) : { teamId: playbook.teamId ?? null };
  const executionState = {
    schemaVersion: 1,
    stepsSnapshot: narrowedPlaybook.steps,
  } as unknown as Prisma.InputJsonValue;
  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.playbookRun.create({
      data: {
        playbookId: input.playbookId,
        status: "queued",
        dryRun: input.dryRun,
        triggerContext: (input.triggerContext ?? null) as Prisma.InputJsonValue,
        stepResults: [] as unknown as Prisma.InputJsonValue,
        executionState,
        startedAt: null,
        createdById: input.createdById ?? null,
        ...teamData,
      },
    });
    const job = await tx.job.create({
      data: {
        type: "playbook.run",
        title: `Run playbook ${narrowedPlaybook.name}`,
        payload: { runId: created.id },
        createdBy: input.createdById ?? null,
        teamId: teamData.teamId ?? null,
        priority: 0,
        maxAttempts: Math.max(1, narrowedPlaybook.chainRetry + 1),
      },
    });
    return tx.playbookRun.update({
      where: { id: created.id },
      data: { jobId: job.id },
    });
  });

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
