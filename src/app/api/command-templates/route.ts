import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { listTemplates, createTemplate, updateTemplate, deleteTemplate } from "@/lib/command-template/service";

export const dynamic = "force-dynamic";

export async function GET() {
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "command:create")) {
			return NextResponse.json({ error: "权限不足" }, { status: 403 });
		}
		const templates = await listTemplates();
		const serialized = templates.map((t) => ({
			id: t.id, name: t.name, description: t.description,
			command: t.command, variables: t.variables, tags: t.tags,
			isBuiltin: t.isBuiltin,
			createdAt: t.createdAt.toISOString(),
			creator: t.creator ? { username: t.creator.username, displayName: t.creator.displayName } : null,
		}));
		return NextResponse.json({ templates: serialized });
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
		const template = await createTemplate({
			name: body.name, description: body.description, command: body.command,
			tags: body.tags, createdById: session.userId,
		});
		return NextResponse.json({ template });
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
		if (!body.id) return NextResponse.json({ error: "缺少模板 ID" }, { status: 400 });
		const result = await updateTemplate(body.id, body);
		return NextResponse.json({ template: result });
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
		if (!id) return NextResponse.json({ error: "缺少模板 ID" }, { status: 400 });
		await deleteTemplate(id);
		return NextResponse.json({ success: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : "删除失败";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}
