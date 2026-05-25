import { NextResponse } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/logging";

const logger = createLogger("api:command-templates");

import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { listTemplates, createTemplate, updateTemplate, deleteTemplate } from "@/lib/command-template/service";
import { auditUserAction } from "@/lib/audit/service";
import { withRateLimit, rateLimitResponse, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

const postSchema = z.object({
	name: z.string().min(1),
	command: z.string().min(1),
	description: z.string().optional(),
	variables: z.array(z.string()).optional(),
	tags: z.array(z.string()).optional(),
});

const patchSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1).optional(),
	command: z.string().min(1).optional(),
	description: z.string().optional(),
	variables: z.array(z.string()).optional(),
	tags: z.array(z.string()).optional(),
});

function auditTemplateDetail(template: { id: string; name?: string | null; isBuiltin?: boolean | null; tags?: string[] | null; variables?: string[] | null }) {
	return {
		templateId: template.id,
		name: template.name ?? null,
		isBuiltin: Boolean(template.isBuiltin),
		tagCount: template.tags?.length ?? 0,
		variableCount: template.variables?.length ?? 0,
	};
}

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
	} catch (error) {
		logger.error("获取命令模板列表失败", error);
		return NextResponse.json({ error: "服务器错误" }, { status: 500 });
	}
}

export async function POST(request: Request) {
	const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
	if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "command:create")) {
			return NextResponse.json({ error: "权限不足" }, { status: 403 });
		}
		const rawBody = await request.json();
		const parsed = postSchema.safeParse(rawBody);
		if (!parsed.success) {
			return NextResponse.json({ error: "输入参数无效" }, { status: 400 });
		}
		const body = parsed.data;
		const template = await createTemplate({
			name: body.name, description: body.description, command: body.command,
			tags: body.tags, createdById: session.userId,
		});
		auditUserAction(session.userId, "command_template.create", auditTemplateDetail(template));
		return NextResponse.json({ template });
	} catch (err) {
		const message = err instanceof Error ? err.message : "创建失败";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}

export async function PATCH(request: Request) {
	const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
	if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "command:create")) {
			return NextResponse.json({ error: "权限不足" }, { status: 403 });
		}
		const rawBody = await request.json();
		const parsed = patchSchema.safeParse(rawBody);
		if (!parsed.success) {
			return NextResponse.json({ error: "输入参数无效" }, { status: 400 });
		}
		const { id, ...updates } = parsed.data;
		const result = await updateTemplate(id, updates);
		auditUserAction(session.userId, "command_template.update", auditTemplateDetail(result));
		return NextResponse.json({ template: result });
	} catch (err) {
		const message = err instanceof Error ? err.message : "更新失败";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}

export async function DELETE(request: Request) {
	const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
	if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "command:create")) {
			return NextResponse.json({ error: "权限不足" }, { status: 403 });
		}
		const { searchParams } = new URL(request.url);
		const id = searchParams.get("id");
		if (!id) return NextResponse.json({ error: "缺少模板 ID" }, { status: 400 });
		const deleted = await deleteTemplate(id);
		auditUserAction(session.userId, "command_template.delete", auditTemplateDetail(deleted));
		return NextResponse.json({ success: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : "删除失败";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}
