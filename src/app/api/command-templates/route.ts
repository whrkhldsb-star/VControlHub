import { NextResponse } from "next/server";
import { listTemplates, createTemplate, updateTemplate, deleteTemplate } from "@/lib/command-template/service";
import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { idQuerySchema, parseSearchParams } from "@/lib/http/parse-search-params";
import { createCommandTemplateSchema, updateCommandTemplateSchema } from "@/lib/command/schema";

import { ValidationError } from "@/lib/errors";
export const dynamic = "force-dynamic";

function auditTemplateDetail(template: { id: string; name?: string | null; isBuiltin?: boolean | null; tags?: string[] | null; variables?: string[] | null }) {
	return {
		templateId: template.id,
		name: template.name ?? null,
		isBuiltin: Boolean(template.isBuiltin),
		tagCount: template.tags?.length ?? 0,
		variableCount: template.variables?.length ?? 0,
	};
}

export async function GET(request: Request) {
	return withApiRoute(request, { permission: "command:read", errorStatus: 500, errorMessage: "服务器错误" }, async () => {
		const templates = await listTemplates();
		const serialized = templates.map((t) => ({
			id: t.id, name: t.name, description: t.description,
			command: t.command, rollbackCommand: t.rollbackCommand, variables: t.variables, tags: t.tags,
			isBuiltin: t.isBuiltin,
			createdAt: t.createdAt.toISOString(),
			creator: t.creator ? { username: t.creator.username, displayName: t.creator.displayName } : null,
		}));
		return NextResponse.json({ templates: serialized });
	});
}

export async function POST(request: Request) {
	return withApiRoute(request, { permission: "command:create", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 400, errorMessage: "创建失败", bodySchema: createCommandTemplateSchema }, async ({ session, body }) => {
		const template = await createTemplate({
			name: body.name, description: body.description, command: body.command, rollbackCommand: body.rollbackCommand,
			tags: body.tags, createdById: session?.userId ?? "",
		});
		auditUserAction(session?.userId ?? "", "command_template.create", auditTemplateDetail(template));
		return NextResponse.json({ template });
	});
}

export async function PATCH(request: Request) {
	return withApiRoute(request, { permission: "command:create", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 400, errorMessage: "更新失败", bodySchema: updateCommandTemplateSchema }, async ({ session, body }) => {
		const { id, ...updates } = body;
		const result = await updateTemplate(id, updates);
		auditUserAction(session?.userId ?? "", "command_template.update", auditTemplateDetail(result));
		return NextResponse.json({ template: result });
	});
}

export async function DELETE(request: Request) {
	return withApiRoute(request, { permission: "command:create", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 400, errorMessage: "删除失败" }, async ({ session }) => {
		const { id } = parseSearchParams(request, idQuerySchema);
		if (!id) throw new ValidationError("缺少模板 ID");
		const deleted = await deleteTemplate(id);
		auditUserAction(session?.userId ?? "", "command_template.delete", auditTemplateDetail(deleted));
		return NextResponse.json({ success: true });
	});
}
