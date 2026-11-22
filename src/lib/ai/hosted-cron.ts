import type { Prisma } from "@prisma/client";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { activeCustomerTeamWhere, seesAllCustomers, serverTeamWhere } from "@/lib/auth/team-scope";
import { BusinessError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { computeNextRun } from "@/lib/scheduled-task/service";
import { sessionForTeamScope, type HostedActionSession } from "./hosted-helpers";

/** The caller commits the approval, task transition and tool reply together. */
export async function applyHostedCronChange(
  tx: Prisma.TransactionClient, teamId: string | null, params: Record<string, unknown>, actor: HostedActionSession,
) {
  const scope = sessionForTeamScope(actor)!;
  if ((scope.currentTeamId !== teamId && !seesAllCustomers(scope)) ||
      (Object.hasOwn(params, "teamId") && params.teamId !== teamId) || typeof params.taskId !== "string") {
    throw new BusinessError(t("backend.ai.automationProposalChanged"));
  }
  if (params.action !== "pause" && params.action !== "resume") throw new BusinessError(t("backend.ai.cron.unsupportedAction"));
  const session = { ...scope, currentTeamId: teamId };
  const where = { id: params.taskId.trim(), AND: [activeCustomerTeamWhere(session), { teamId }] };
  // Two different approval cards can ask for the same transition. Read the status
  // after acquiring the task lock so the second can record an idempotent receipt.
  await tx.$queryRaw`SELECT id FROM scheduled_tasks WHERE id = ${where.id}
    AND "teamId" IS NOT DISTINCT FROM ${teamId}::text FOR UPDATE`;
  const task = await tx.scheduledTask.findFirst({ where });
  if (!task) throw new NotFoundError(t("backend.scheduled-task.scheduledTaskNotFound"));
  if (!task.approvalRequired && !sessionHasPermission(actor, "command:execute")) {
    throw new ForbiddenError(t("backend.scheduled-task.manageUnattendedRequiresExecutor"));
  }
  const status = params.action === "pause" ? "PAUSED" : "ACTIVE";
  if (task.status === status) {
    const message = t(status === "PAUSED" ? "backend.ai.cron.alreadyPaused" : "backend.ai.cron.alreadyActive");
    return { id: task.id, status, message };
  }
  if (task.status !== "ACTIVE" && task.status !== "PAUSED") {
    throw new BusinessError(t(status === "PAUSED" ? "backend.ai.cron.cannotPauseStatus" : "backend.ai.cron.cannotResumeStatus", { status: task.status }));
  }
  let nextRunAt = null;
  if (status === "ACTIVE") {
    if (!task.approvalRequired) {
      const ids = [...new Set(task.serverIds.map((id) => id.trim()).filter(Boolean))];
      const count = await tx.server.count({ where: { id: { in: ids }, teamId, AND: [serverTeamWhere(session, "connect")] } });
      if (count !== ids.length) throw new ForbiddenError(t("backend.ai.automationSelectedTargetsUnavailable"));
    }
    if (task.scheduleType === "ONCE" && (!task.runAt || task.runAt.getTime() <= Date.now())) {
      throw new BusinessError(t("backend.scheduled-task.completedCannotResume"));
    }
    nextRunAt = task.scheduleType === "ONCE" ? task.runAt : computeNextRun(task.cronExpression);
  }
  const updated = await tx.scheduledTask.updateMany({
    where: { ...where, updatedAt: task.updatedAt, status: task.status, approvalRequired: task.approvalRequired },
    data: { status, nextRunAt, claimedOccurrenceAt: null },
  });
  if (!updated.count) throw new ConflictError(t("backend.scheduled-task.taskChangedRetry"));
  return { id: task.id, status };
}
