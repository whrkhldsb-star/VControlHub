/**
 * TR-023 M04: Playbook service — CRUD + chain execution entry point.
 *
 * Pattern mirrors `command-template/service.ts`: thin Prisma wrapper that
 * returns narrowed `PlaybookRecord` / `PlaybookRunRecord` shapes so callers
 * (UI, API routes, executor) never have to re-parse the `triggerConfig`
 * or `steps` JSON columns.
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { auditUserAction } from "@/lib/audit/service";

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
import { executePlaybookChain } from "./executor";

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

export async function listPlaybooks(): Promise<PlaybookRecord[]> {
  const rows = await prisma.playbook.findMany({
    orderBy: { createdAt: "desc" },
  });
  return rows.map(narrowPlaybook);
}

export async function getPlaybook(id: string): Promise<PlaybookRecord | null> {
  const row = await prisma.playbook.findUnique({ where: { id } });
  return row ? narrowPlaybook(row) : null;
}

export async function createPlaybook(
  input: CreatePlaybookInput,
  createdById: string,
): Promise<PlaybookRecord> {
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
    },
  });
  const narrowed = narrowPlaybook(row);
  auditUserAction(createdById, "playbook.create", {
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
): Promise<PlaybookRecord> {
  const { id, ...rest } = input;
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
  auditUserAction(updatedById, "playbook.update", {
    playbookId: narrowed.id,
    name: narrowed.name,
    enabled: narrowed.enabled,
    stepCount: narrowed.steps.length,
  });
  return narrowed;
}

export async function deletePlaybook(id: string, deletedById: string): Promise<void> {
  await prisma.playbook.delete({ where: { id } });
  auditUserAction(deletedById, "playbook.delete", { playbookId: id });
}

export async function listPlaybookRuns(playbookId: string): Promise<PlaybookRunRecord[]> {
  const rows = await prisma.playbookRun.findMany({
    where: { playbookId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map(narrowPlaybookRun);
}

/**
 * Run a playbook chain. The `dryRun` flag is forwarded to the executor;
 * when true, side-effecting steps (run_command, send_notification) are
 * skipped — only the planning + audit trail happens.
 *
 * Returns the persisted run record (status=failed/completed) so the API
 * route can stream it back to the client. The function awaits the full
 * chain; in production we may want to enqueue `playbook.run` as a Job
 * instead — that lives in the `playbook.run` worker registered in
 * `src/lib/command/worker.ts` for follow-up work.
 */
export async function runPlaybook(input: {
  playbookId: string;
  dryRun: boolean;
  triggerContext?: unknown;
  createdById?: string;
}): Promise<PlaybookRunRecord> {
  const playbook = await prisma.playbook.findUnique({
    where: { id: input.playbookId },
  });
  if (!playbook) {
    throw new Error(`playbook not found: ${input.playbookId}`);
  }
  const narrowedPlaybook = narrowPlaybook(playbook);
  if (!narrowedPlaybook.enabled) {
    throw new Error(`playbook is disabled: ${input.playbookId}`);
  }

  const run = await prisma.playbookRun.create({
    data: {
      playbookId: input.playbookId,
      status: "running",
      dryRun: input.dryRun,
      triggerContext: (input.triggerContext ?? null) as Prisma.InputJsonValue,
      stepResults: [] as unknown as Prisma.InputJsonValue,
      startedAt: new Date(),
      createdById: input.createdById ?? null,
    },
  });

  let stepResults: PlaybookStepResult[] = [];
  let finalStatus: "completed" | "failed" = "completed";
  let errorMessage: string | null = null;
  try {
    stepResults = await executePlaybookChain({
      playbook: narrowedPlaybook,
      runId: run.id,
      dryRun: input.dryRun,
    });
    const anyFailed = stepResults.some((r) => r.status === "failed");
    if (anyFailed) {
      finalStatus = "failed";
      const failed = stepResults.find((r) => r.status === "failed");
      errorMessage = failed?.error ?? "step failed";
    }
  } catch (err) {
    finalStatus = "failed";
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const updated = await prisma.playbookRun.update({
    where: { id: run.id },
    data: {
      status: finalStatus,
      stepResults: stepResults as unknown as Prisma.InputJsonValue,
      errorMessage,
      completedAt: new Date(),
    },
  });

  if (input.createdById) {
    auditUserAction(input.createdById, "playbook.run", {
      playbookId: input.playbookId,
      runId: run.id,
      dryRun: input.dryRun,
      status: finalStatus,
      stepCount: stepResults.length,
    });
  }

  return narrowPlaybookRun(updated);
}
