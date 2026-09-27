import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { roleTemplateInputSchema, createRoleTemplate, listRoleTemplates } from "@/lib/auth/role-template-service";
import { ForbiddenError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(request, { permissions: ["user:read", "team:member:manage"] }, async ({ session }) => {
    return NextResponse.json({ templates: await listRoleTemplates(session.currentTeamId) });
  });
}

export async function POST(request: Request) {
  return withApiRoute(request, { permissions: ["role:manage", "team:member:manage"], rateLimit: GENERAL_WRITE_LIMIT, bodySchema: roleTemplateInputSchema }, async ({ session, body }) => {
    if (!session.currentTeamId) throw new ForbiddenError();
    const template = await createRoleTemplate(body, session.userId, session.currentTeamId);
    await auditUserAction(session.userId, "role_template.create", { templateId: template.id, name: template.name }, undefined, session.currentTeamId);
    return NextResponse.json({ template }, { status: 201 });
  });
}
