import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { createScheduledTask, listScheduledTasks, updateScheduledTask, deleteScheduledTask, toggleScheduledTask } from "@/lib/scheduled-task/service";

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
	} catch {
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
		const task = await createScheduledTask({
			name: body.name,
			cronExpression: body.cronExpression,
			command: body.command,
			reason: body.reason,
			serverIds: body.serverIds ?? [],
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
		if (body.toggleId) {
			const result = await toggleScheduledTask(body.toggleId);
			return NextResponse.json({ task: result });
		}
		if (!body.id) return NextResponse.json({ error: "缺少任务 ID" }, { status: 400 });
		const result = await updateScheduledTask(body.id, body);
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
