import { NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { idQuerySchema, parseSearchParams } from "@/lib/http/parse-search-params";
import { AuthError, ValidationError } from "@/lib/errors";
import { getServerLocale, t } from "@/lib/i18n/translations";
import {
  createScheduledTask,
  deleteScheduledTask,
  describeCron,
  listScheduledTasks,
  retryScheduledTask,
  toggleScheduledTask,
  updateScheduledTask,
} from "@/lib/scheduled-task/service";

const scheduledTaskPostSchema = z.object({
  name: z.string().min(1),
  cron: z.string().min(1).optional(),
  command: z.string().min(1),
  serverId: z.string().min(1).optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  cronExpression: z.string().min(1).optional(),
  reason: z.string().optional(),
  serverIds: z.array(z.string()).optional(),
}).refine((data) => Boolean(data.cronExpression ?? data.cron), {
  message: "请填写 Cron 表达式",
  path: ["cronExpression"],
}).refine((data) => (data.serverIds?.length ?? 0) > 0 || Boolean(data.serverId), {
  message: "请至少选择一台目标 VPS",
  path: ["serverIds"],
});

const scheduledTaskPatchSchema = z.object({
  id: z.string().optional(),
  toggleId: z.string().optional(),
  retryId: z.string().optional(),
  name: z.string().optional(),
  cron: z.string().optional(),
  cronExpression: z.string().optional(),
  command: z.string().optional(),
  serverId: z.string().optional(),
  serverIds: z.array(z.string()).optional(),
  reason: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]).optional(),
});

export const dynamic = "force-dynamic";

type ScheduledTaskAuditPayload = {
  id?: string;
  name?: string;
  cronExpression?: string;
  serverIds?: string[];
  status?: string;
};

function auditScheduledTaskDetail(task: ScheduledTaskAuditPayload) {
  return {
    taskId: task.id ?? null,
    name: task.name ?? null,
    cronExpression: task.cronExpression ?? null,
    serverCount: task.serverIds?.length ?? 0,
    status: task.status ?? null,
  };
}

export async function GET(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "command:read",
      errorMessage: t("api.serverError", "zh"),
    },
    async ({ session }) => {
      const locale = await getServerLocale();
      if (!session) throw new AuthError(t("api.unauthorized", locale));
      const tasks = await listScheduledTasks(200, session);
      const serialized = tasks.map((task) => ({
        id: task.id,
        name: task.name,
        cronExpression: task.cronExpression,
        cronDescription: describeCron(task.cronExpression),
        command: task.command,
        reason: task.reason,
        status: task.status,
        serverIds: task.serverIds,
        lastRunAt: task.lastRunAt?.toISOString() ?? null,
        nextRunAt: task.nextRunAt?.toISOString() ?? null,
        lastResult: task.lastResult,
        runCount: task.runCount,
        createdAt: task.createdAt.toISOString(),
        creator: task.creator,
      }));
      return NextResponse.json({ tasks: serialized });
    },
  );
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "command:create",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: scheduledTaskPostSchema,
      errorStatus: 400,
      errorMessage: t("api.creationFailed", "zh"),
    },
    async ({ session, body: data }) => {
      const locale = await getServerLocale();
      if (!session)
        throw new AuthError(t("api.unauthorized", locale));
      const cronExpression = data.cronExpression ?? data.cron;
      if (!cronExpression)
        throw new ValidationError(t("api.cronRequired", locale));
      const task = await createScheduledTask(
        {
          name: data.name,
          cronExpression,
          command: data.command,
          reason: data.reason ?? data.description,
          serverIds: data.serverIds ?? (data.serverId ? [data.serverId] : []),
          createdById: session.userId,
        },
        session,
      );
      await auditUserAction(
        session.userId,
        "scheduled_task.create",
        auditScheduledTaskDetail(task), undefined, session?.currentTeamId);
      return NextResponse.json({ task });
    },
  );
}

export async function PATCH(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "command:create",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: scheduledTaskPatchSchema,
      errorStatus: 400,
      errorMessage: t("api.updateFailed", "zh"),
    },
    async ({ session, body: data }) => {
      const locale = await getServerLocale();
      if (!session)
        throw new AuthError(t("api.unauthorized", locale));
      if (data.toggleId) {
        const result = await toggleScheduledTask(data.toggleId, session);
        await auditUserAction(
          session.userId,
          "scheduled_task.toggle",
          auditScheduledTaskDetail(result), undefined, session?.currentTeamId);
        return NextResponse.json({ task: result });
      }
      if (data.retryId) {
        const result = await retryScheduledTask(data.retryId, session);
        await auditUserAction(
          session.userId,
          "scheduled_task.retry",
          auditScheduledTaskDetail(result), undefined, session?.currentTeamId);
        return NextResponse.json({ task: result });
      }
      if (!data.id)
        throw new ValidationError(t("api.missingTaskId", locale));
      const result = await updateScheduledTask(
        data.id,
        {
          name: data.name,
          cronExpression: data.cronExpression ?? data.cron,
          command: data.command,
          reason: data.reason ?? data.description,
          serverIds: data.serverIds ?? (data.serverId ? [data.serverId] : undefined),
          status: data.status,
        },
        session,
      );
      await auditUserAction(
        session.userId,
        "scheduled_task.update",
        auditScheduledTaskDetail(result), undefined, session?.currentTeamId);
      return NextResponse.json({ task: result });
    },
  );
}

export async function DELETE(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "command:create",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorStatus: 400,
      errorMessage: t("api.deleteFailed", "zh"),
    },
    async ({ session }) => {
      const locale = await getServerLocale();
      if (!session)
        throw new AuthError(t("api.unauthorized", locale));
      const { id } = parseSearchParams(request, idQuerySchema);
      const deleted = await deleteScheduledTask(id, session);
      await auditUserAction(
        session.userId,
        "scheduled_task.delete",
        auditScheduledTaskDetail(deleted),
        "WARNING",
        session?.currentTeamId,
      );
      return NextResponse.json({ success: true });
    },
  );
}
