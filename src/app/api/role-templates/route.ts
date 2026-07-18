import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { roleTemplateInputSchema, createRoleTemplate, listRoleTemplates } from "@/lib/auth/role-template-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "user:read" }, async () => {
    return NextResponse.json({ templates: await listRoleTemplates() });
  });
}

export async function POST(request: Request) {
  return withApiRoute(request, { permission: "role:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: roleTemplateInputSchema }, async ({ session, body }) => {
    const template = await createRoleTemplate(body, session!.userId);
    await auditUserAction(session!.userId, "role_template.create", { templateId: template.id, name: template.name }, undefined, session?.currentTeamId);
    return NextResponse.json({ template }, { status: 201 });
  });
}
