import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { roleTemplateInputSchema, updateRoleTemplate, deleteRoleTemplate } from "@/lib/auth/role-template-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(request, { permission: "role:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: roleTemplateInputSchema }, async ({ session, body }) => {
    const { id } = await params;
    const template = await updateRoleTemplate(id, body);
    await auditUserAction(session!.userId, "role_template.update", { templateId: id, name: template.name });
    return NextResponse.json({ template });
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(request, { permission: "role:manage", rateLimit: GENERAL_WRITE_LIMIT }, async ({ session }) => {
    const { id } = await params;
    await deleteRoleTemplate(id);
    await auditUserAction(session!.userId, "role_template.delete", { templateId: id }, "WARNING");
    return NextResponse.json({ success: true });
  });
}
