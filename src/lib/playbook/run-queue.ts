/**
 * Transactional PlaybookRun + durable Job creation shared by manual and
 * automatic triggers. Keeping the two records in one transaction prevents a
 * visible run with no executor (or an orphan executor with no run history).
 */
import { Prisma } from "@prisma/client";

import { liveCustomerRowsWhere, lockLiveCustomer } from "@/lib/auth/team-scope";
import { NotFoundError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { enqueueJob } from "@/lib/job/service";

import { playbookRetrySchema } from "./schema";
import type { PlaybookStep } from "./types";
import { toJsonValue } from "@/lib/db/json";

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
  sourceAlert?: { serverId?: string; teamId: string | null };
  triggerKey?: string | null;
  createdById?: string | null;
}) {
  if (input.playbook.teamId) await lockLiveCustomer(input.client, input.playbook.teamId);
  if (input.sourceAlert && input.playbook.teamId !== null) {
    // A platform rule may bind playbooks in several customers. Only the owner of the
    // triggering host may receive this sample. Resolve ownership again at enqueue.
    const context = input.triggerContext as { serverId?: unknown } | null;
    const id = input.sourceAlert.serverId;
    const host = id && context?.serverId === id && await input.client.server.findFirst({
      where: { id, teamId: input.playbook.teamId, enabled: true, ...liveCustomerRowsWhere() }, select: { id: true },
    });
    if (!host) throw new NotFoundError(t("backend.alert.oneOrMoreServeridsAreOutsideTheCurrent"));
  }
  const triggerKey = input.triggerKey?.trim() || null;
  if (triggerKey) {
    const existing = await input.client.playbookRun.findFirst({
      where: { playbookId: input.playbook.id, triggerKey },
    });
    if (existing) return { run: existing, created: false };
  }

  const actorId = input.createdById ?? (input.sourceAlert ? input.playbook.createdById : null);
  const executionState = toJsonValue({
    schemaVersion: 2,
    actorId,
    chainRetry: input.playbook.chainRetry,
    ...(input.sourceAlert ? { sourceRuleTeamId: input.sourceAlert.teamId } : {}),
    stepsSnapshot: input.playbook.steps,
  });
  const run = await input.client.playbookRun.create({
    data: {
      playbookId: input.playbook.id,
      status: "queued",
      dryRun: input.dryRun,
      triggerContext: (input.triggerContext ?? null) as Prisma.InputJsonValue,
      triggerKey,
      stepResults: toJsonValue([]),
      executionState,
      startedAt: null,
      createdById: actorId,
      teamId: input.playbook.teamId ?? null,
    },
  });
  // A legacy invalid budget gets one job attempt to record the executor's
  // validation failure. It must not grant extra durable retries.
  const retries = playbookRetrySchema.safeParse(input.playbook.chainRetry);
  const job = await enqueueJob(
    {
      type: "playbook.run",
      title: `Run playbook ${input.playbook.name}`,
      payload: { runId: run.id },
      createdBy: actorId,
      teamId: input.playbook.teamId ?? null,
      priority: 0,
      maxAttempts: retries.success ? 1 + retries.data : 1,
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
