import type { Prisma } from "@prisma/client";
import { liveCustomerRowsWhere } from "@/lib/auth/team-scope";
import { lockForTransaction } from "@/lib/concurrency/advisory-lock";
import { queuePlaybookRunWithClient } from "@/lib/playbook/run-queue";
import type { PlaybookStep } from "@/lib/playbook/types";
import type { AlertFireInput } from "./incidents";

/** The incident opening, the immutable runs and their durable jobs share one commit. */
export async function queueIncidentRemediation(tx: Prisma.TransactionClient, input: AlertFireInput, incidentId: string, openedAt: Date) {
  if (!input.playbookIds?.length || !input.serverId) return;
  // Serialize with manual runs, ownership changes and deletion, which checks
  // for active runs under this same lock. Bindings may overlap across rules.
  const requested = [...new Set(input.playbookIds)].sort();
  for (const id of requested) await lockForTransaction(tx, "playbook-lifecycle", id);
  const rule = await tx.alertRule.findFirst({
    where: { id: input.ruleId, teamId: input.teamId ?? null, enabled: true, ...liveCustomerRowsWhere() },
    select: { playbookIds: true },
  });
  const ids = requested.filter((id) => rule?.playbookIds.includes(id));
  if (!ids.length) return;
  const host = await tx.server.findFirst({
    where: { id: input.serverId, enabled: true, ...(input.teamId ? { teamId: input.teamId } : {}), ...liveCustomerRowsWhere() },
    select: { teamId: true },
  });
  if (!host) return;
  const playbooks = await tx.playbook.findMany({
    where: { id: { in: ids }, enabled: true, OR: [
      { teamId: host.teamId }, ...(input.teamId ? [] : [{ teamId: null }]),
    ] },
    orderBy: { id: "asc" },
  });
  for (const playbook of playbooks) {
    await queuePlaybookRunWithClient({
      client: tx, playbook: { ...playbook, steps: playbook.steps as unknown as PlaybookStep[] },
      dryRun: false, sourceAlert: { teamId: input.teamId ?? null, serverId: input.serverId },
      triggerKey: `alert:${incidentId}:${openedAt.toISOString()}`,
      triggerContext: {
        type: input.metric.startsWith("capacity_") ? "capacity_forecast" : "alert_rule",
        alertRuleId: input.ruleId, alertRuleName: input.ruleName, incidentId,
        serverId: input.serverId, serverName: input.serverName, metric: input.metric,
        operator: input.operator, threshold: input.threshold, value: input.value, triggeredAt: openedAt.toISOString(),
      },
    });
  }
}
