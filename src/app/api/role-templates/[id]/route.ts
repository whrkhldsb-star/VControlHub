import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { roleTemplateInputSchema, updateRoleTemplate, deleteRoleTemplate } from "@/lib/auth/role-template-service";
import { ForbiddenError } from "@/lib/errors";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(request, { permissions: ["role:manage", "team:member:manage"], rateLimit: GENERAL_WRITE_LIMIT, bodySchema: roleTemplateInputSchema }, async ({ session, body }) => {
    const { id } = await params;
    if (!session.currentTeamId) throw new ForbiddenError();
    const template = await updateRoleTemplate(id, body, session.currentTeamId);
    await auditUserAction(session.userId, "role_template.update", { templateId: id, name: template.name }, undefined, session.currentTeamId);
    return NextResponse.json({ template });
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(request, { permissions: ["role:manage", "team:member:manage"], rateLimit: GENERAL_WRITE_LIMIT }, async ({ session }) => {
    const { id } = await params;
    if (!session.currentTeamId) throw new ForbiddenError();
    await deleteRoleTemplate(id, session.currentTeamId);
    await auditUserAction(session.userId, "role_template.delete", { templateId: id }, "WARNING", session.currentTeamId);
    return NextResponse.json({ success: true });
  });
}
