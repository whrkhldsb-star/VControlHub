import { NextResponse } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/logging";

const logger = createLogger("api:scheduled-tasks");

import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { createScheduledTask, listScheduledTasks, updateScheduledTask, deleteScheduledTask, toggleScheduledTask } from "@/lib/scheduled-task/service";

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

export async function GET() {
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "command:create")) {
			return NextResponse.json({ error: "权限不足" }, { status: 403 });
		}
		const tasks = await listScheduledTasks();
		const serialized = tasks.map((t) => ({
			id: t.id,
			name: t.name,
			cronExpression: t.cronExpression,
			command: t.command,
			reason: t.reason,
			status: t.status,
			serverIds: t.serverIds,
			lastRunAt: t.lastRunAt?.toISOString() ?? null,
			nextRunAt: t.nextRunAt?.toISOString() ?? null,
			lastResult: t.lastResult,
			runCount: t.runCount,
			createdAt: t.createdAt.toISOString(),
			creator: t.creator,
		}));
		return NextResponse.json({ tasks: serialized });
	} catch (error) {
		logger.error("获取计划任务列表失败", error);
		return NextResponse.json({ error: "服务器错误" }, { status: 500 });
	}
}

export async function POST(request: Request) {
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "command:create")) {
			return NextResponse.json({ error: "权限不足" }, { status: 403 });
		}
		const body = await request.json();
		const parsed = scheduledTaskPostSchema.safeParse(body);
		if (!parsed.success) return NextResponse.json({ error: "输入校验失败", details: parsed.error.flatten().fieldErrors }, { status: 400 });
		const data = parsed.data;
		const task = await createScheduledTask({
			name: data.name,
			cronExpression: data.cronExpression ?? data.cron,
			command: data.command,
			reason: data.reason ?? data.description,
			serverIds: data.serverIds ?? (data.serverId ? [data.serverId] : []),
			createdById: session.userId,
		});
		return NextResponse.json({ task });
	} catch (err) {
		const message = err instanceof Error ? err.message : "创建失败";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}

export async function PATCH(request: Request) {
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "command:create")) {
			return NextResponse.json({ error: "权限不足" }, { status: 403 });
		}
		const body = await request.json();
		const parsed = scheduledTaskPatchSchema.safeParse(body);
		if (!parsed.success) return NextResponse.json({ error: "输入校验失败", details: parsed.error.flatten().fieldErrors }, { status: 400 });
		const data = parsed.data;
		if (data.toggleId) {
			const result = await toggleScheduledTask(data.toggleId);
			return NextResponse.json({ task: result });
		}
		if (!data.id) return NextResponse.json({ error: "缺少任务 ID" }, { status: 400 });
		const result = await updateScheduledTask(data.id, data);
		return NextResponse.json({ task: result });
	} catch (err) {
		const message = err instanceof Error ? err.message : "更新失败";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}

export async function DELETE(request: Request) {
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "command:create")) {
			return NextResponse.json({ error: "权限不足" }, { status: 403 });
		}
		const { searchParams } = new URL(request.url);
		const id = searchParams.get("id");
		if (!id) return NextResponse.json({ error: "缺少任务 ID" }, { status: 400 });
		await deleteScheduledTask(id);
		return NextResponse.json({ success: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : "删除失败";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}
