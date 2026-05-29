import { NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import {
  createScheduledTask,
  deleteScheduledTask,
  listScheduledTasks,
  toggleScheduledTask,
  updateScheduledTask,
} from "@/lib/scheduled-task/service";

const scheduledTaskPostSchema = z.object({
  name: z.string().min(1),
  cron: z.string().min(1),
  command: z.string().min(1),
  serverId: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  cronExpression: z.string().optional(),
  reason: z.string().optional(),
  serverIds: z.array(z.string()).optional(),
});

const scheduledTaskPatchSchema = z.object({
  id: z.string().min(1),
  toggleId: z.string().optional(),
  name: z.string().optional(),
  cron: z.string().optional(),
  command: z.string().optional(),
  serverId: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
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
    { permission: "command:create", errorMessage: "服务器错误" },
    async () => {
      const tasks = await listScheduledTasks();
      const serialized = tasks.map((task) => ({
        id: task.id,
        name: task.name,
        cronExpression: task.cronExpression,
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
      errorStatus: 400,
      errorMessage: "创建失败",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });
      const body = await request.json().catch(() => null);
      const parsed = scheduledTaskPostSchema.safeParse(body);
      if (!parsed.success)
        return NextResponse.json(
          {
            error: "输入校验失败",
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 400 },
        );
      const data = parsed.data;
      const task = await createScheduledTask({
        name: data.name,
        cronExpression: data.cronExpression ?? data.cron,
        command: data.command,
        reason: data.reason ?? data.description,
        serverIds: data.serverIds ?? (data.serverId ? [data.serverId] : []),
        createdById: session.userId,
      });
      auditUserAction(
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
      errorStatus: 400,
      errorMessage: "更新失败",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });
      const body = await request.json().catch(() => null);
      const parsed = scheduledTaskPatchSchema.safeParse(body);
      if (!parsed.success)
        return NextResponse.json(
          {
            error: "输入校验失败",
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 400 },
        );
      const data = parsed.data;
      if (data.toggleId) {
        const result = await toggleScheduledTask(data.toggleId);
        auditUserAction(
          session.userId,
          "scheduled_task.toggle",
          auditScheduledTaskDetail(result),
        );
        return NextResponse.json({ task: result });
      }
      if (!data.id)
        return NextResponse.json({ error: "缺少任务 ID" }, { status: 400 });
      const result = await updateScheduledTask(data.id, data);
      auditUserAction(
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
      errorMessage: "删除失败",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });
      const { searchParams } = new URL(request.url);
      const id = searchParams.get("id");
      if (!id)
        return NextResponse.json({ error: "缺少任务 ID" }, { status: 400 });
      const deleted = await deleteScheduledTask(id);
      auditUserAction(
        session.userId,
        "scheduled_task.delete",
        auditScheduledTaskDetail(deleted),
        "WARNING",
      );
      return NextResponse.json({ success: true });
    },
  );
}
