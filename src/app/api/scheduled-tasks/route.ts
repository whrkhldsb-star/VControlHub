import { NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { idQuerySchema, parseSearchParams } from "@/lib/http/parse-search-params";
import { AuthError, ValidationError } from "@/lib/errors";
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
  message: "Cron expression is required",
  path: ["cronExpression"],
}).refine((data) => (data.serverIds?.length ?? 0) > 0 || Boolean(data.serverId), {
  message: "Please select at least one target VPS",
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
      errorMessage: "Server error",
    },
    async () => {
      const tasks = await listScheduledTasks();
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
      errorMessage: "Creation failed",
    },
    async ({ session, body: data }) => {
      if (!session)
        throw new AuthError("Unauthorized");
      const cronExpression = data.cronExpression ?? data.cron;
      if (!cronExpression)
        throw new ValidationError("Cron expression is required");
      const task = await createScheduledTask({
        name: data.name,
        cronExpression,
        command: data.command,
        reason: data.reason ?? data.description,
        serverIds: data.serverIds ?? (data.serverId ? [data.serverId] : []),
        createdById: session.userId,
      });
      await auditUserAction(
        session.userId,
        "scheduled_task.create",
        auditScheduledTaskDetail(task),
      );
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
      errorMessage: "Update failed",
    },
    async ({ session, body: data }) => {
      if (!session)
        throw new AuthError("Unauthorized");
      if (data.toggleId) {
        const result = await toggleScheduledTask(data.toggleId);
        await auditUserAction(
          session.userId,
          "scheduled_task.toggle",
          auditScheduledTaskDetail(result),
        );
        return NextResponse.json({ task: result });
      }
      if (data.retryId) {
        const result = await retryScheduledTask(data.retryId);
        await auditUserAction(
          session.userId,
          "scheduled_task.retry",
          auditScheduledTaskDetail(result),
        );
        return NextResponse.json({ task: result });
      }
      if (!data.id)
        throw new ValidationError("Missing task ID");
      const result = await updateScheduledTask(data.id, {
        name: data.name,
        cronExpression: data.cronExpression ?? data.cron,
        command: data.command,
        reason: data.reason ?? data.description,
        serverIds: data.serverIds ?? (data.serverId ? [data.serverId] : undefined),
        status: data.status,
      });
      await auditUserAction(
        session.userId,
        "scheduled_task.update",
        auditScheduledTaskDetail(result),
      );
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
      errorMessage: "Delete failed",
    },
    async ({ session }) => {
      if (!session)
        throw new AuthError("Unauthorized");
      const { id } = parseSearchParams(request, idQuerySchema);
      const deleted = await deleteScheduledTask(id);
      await auditUserAction(
        session.userId,
        "scheduled_task.delete",
        auditScheduledTaskDetail(deleted),
        "WARNING",
      );
      return NextResponse.json({ success: true });
    },
  );
}
