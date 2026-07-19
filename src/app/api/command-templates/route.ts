import { NextResponse } from "next/server";
import { listTemplates, createTemplate, updateTemplate, deleteTemplate } from "@/lib/command-template/service";
import { auditUserAction } from "@/lib/audit/service";
import { sessionHasPermission } from "@/lib/auth/authorization";
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

function templateActor(session: { userId?: string | null; roles?: string[] } | null) {
	const roles = Array.isArray(session?.roles) ? session.roles : [];
	return {
		userId: session?.userId ?? null,
		// role:manage is admin-only in DEFAULT_ROLE_PERMISSIONS — allows cross-user template cleanup.
		canManageAll: sessionHasPermission({ roles: roles as never }, "role:manage"),
	};
}

export async function GET(request: Request) {
	return withApiRoute(request, { permission: "command:read", errorStatus: 500, errorMessage: "Server error" }, async () => {
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
	return withApiRoute(request, { permission: "command:create", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 400, errorMessage: "Creation failed", bodySchema: createCommandTemplateSchema }, async ({ session, body }) => {
		const template = await createTemplate({
			name: body.name, description: body.description, command: body.command, rollbackCommand: body.rollbackCommand,
			tags: body.tags, createdById: session?.userId ?? "",
		});
		await auditUserAction(session?.userId ?? "", "command_template.create", auditTemplateDetail(template), undefined, session?.currentTeamId);
		return NextResponse.json({ template });
	});
}

export async function PATCH(request: Request) {
	return withApiRoute(request, { permission: "command:create", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 400, errorMessage: "Update failed", bodySchema: updateCommandTemplateSchema }, async ({ session, body }) => {
		const { id, ...updates } = body;
		const result = await updateTemplate(id, updates, templateActor(session));
		await auditUserAction(session?.userId ?? "", "command_template.update", auditTemplateDetail(result), undefined, session?.currentTeamId);
		return NextResponse.json({ template: result });
	});
}

export async function DELETE(request: Request) {
	return withApiRoute(request, { permission: "command:create", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 400, errorMessage: "Delete failed" }, async ({ session }) => {
		const { id } = parseSearchParams(request, idQuerySchema);
		if (!id) throw new ValidationError("Missing template ID");
		const deleted = await deleteTemplate(id, templateActor(session));
		await auditUserAction(session?.userId ?? "", "command_template.delete", auditTemplateDetail(deleted), undefined, session?.currentTeamId);
		return NextResponse.json({ success: true });
	});
}
