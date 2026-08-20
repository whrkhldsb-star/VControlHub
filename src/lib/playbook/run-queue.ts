/**
 * Transactional PlaybookRun + durable Job creation shared by manual and
 * automatic triggers. Keeping the two records in one transaction prevents a
 * visible run with no executor (or an orphan executor with no run history).
 */
import { Prisma } from "@prisma/client";

import { enqueueJob } from "@/lib/job/service";

import type { PlaybookStep } from "./types";

export type QueueablePlaybook = {
  id: string;
  name: string;
  steps: PlaybookStep[];
  chainRetry: number;
  createdById: string | null;
  teamId: string | null;
};

export async function queuePlaybookRunWithClient(input: {
  client: Prisma.TransactionClient;
  playbook: QueueablePlaybook;
  dryRun: boolean;
  triggerContext?: unknown;
  triggerKey?: string | null;
  createdById?: string | null;
}) {
  const triggerKey = input.triggerKey?.trim() || null;
  if (triggerKey) {
    const existing = await input.client.playbookRun.findFirst({
      where: { playbookId: input.playbook.id, triggerKey },
    });
    if (existing) return { run: existing, created: false };
  }

  const executionState = {
    schemaVersion: 1,
    stepsSnapshot: input.playbook.steps,
  } as unknown as Prisma.InputJsonValue;
  const run = await input.client.playbookRun.create({
    data: {
      playbookId: input.playbook.id,
      status: "queued",
      dryRun: input.dryRun,
      triggerContext: (input.triggerContext ?? null) as Prisma.InputJsonValue,
      triggerKey,
      stepResults: [] as unknown as Prisma.InputJsonValue,
      executionState,
      startedAt: null,
      createdById: input.createdById ?? null,
      teamId: input.playbook.teamId ?? null,
    },
  });
  const job = await enqueueJob(
    {
      type: "playbook.run",
      title: `Run playbook ${input.playbook.name}`,
      payload: { runId: run.id },
      createdBy: input.createdById ?? null,
      teamId: input.playbook.teamId ?? null,
      priority: 0,
      maxAttempts: Math.max(1, input.playbook.chainRetry + 1),
    },
    input.client,
  );
  return {
    run: await input.client.playbookRun.update({
      where: { id: run.id },
      data: { jobId: job.id },
    }),
    created: true,
  };
}
