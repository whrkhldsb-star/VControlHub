import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { ROLE_TEMPLATE_KINDS, roleTemplateInputSchema, createRoleTemplate, listRoleTemplates, type RoleTemplateKind } from "@/lib/auth/role-template-service";
import { isGlobalTeamManager } from "@/lib/auth/team-scope";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

export const dynamic = "force-dynamic";
const ROLE_TEMPLATE_BODY_LIMIT = 4 * 1024 * 1024;

function requestedKind(request: Request): RoleTemplateKind {
  const value = new URL(request.url).searchParams.get("kind") ?? "ACCOUNT_TEMPLATE";
  if (!(ROLE_TEMPLATE_KINDS as readonly string[]).includes(value)) {
    throw new ValidationError(t("backend.auth.invalidTemplateKind"));
  }
  return value as RoleTemplateKind;
}

export async function GET(request: Request) {
  return withApiRoute(request, { permissions: ["user:read", "team:member:manage"] }, async ({ session }) => {
    const kind = requestedKind(request);
    if (kind === "ACCOUNT_TEMPLATE" && !isGlobalTeamManager(session)) {
      throw new ForbiddenError();
    }
    return NextResponse.json({ templates: await listRoleTemplates(session.currentTeamId, kind) });
  });
}

export async function POST(request: Request) {
  return withApiRoute(request, { permissions: ["role:manage", "team:member:manage"], rateLimit: GENERAL_WRITE_LIMIT, bodySchema: roleTemplateInputSchema, maxBodyBytes: ROLE_TEMPLATE_BODY_LIMIT }, async ({ session, body }) => {
    if (!session.currentTeamId) throw new ForbiddenError();
    const template = await createRoleTemplate(body, session.userId, session.currentTeamId, isGlobalTeamManager(session));
    await auditUserAction(session.userId, "role_template.create", { templateId: template.id, name: template.name, kind: template.kind }, undefined, session.currentTeamId);
    return NextResponse.json({ template }, { status: 201 });
  });
}
