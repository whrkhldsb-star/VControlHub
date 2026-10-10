import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { deleteIdentityTemplate, identityTemplateInputSchema, updateIdentityTemplate } from "@/lib/auth/identity-template-service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  return withApiRoute(
    request,
    { permission: "team:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: identityTemplateInputSchema },
    async ({ session, body }) => {
      const { id } = await params;
      const template = await updateIdentityTemplate(id, body);
      await auditUserAction(session.userId, "identity_template.update", { templateId: id, name: template.name });
      return NextResponse.json({ template });
    },
  );
}

export async function DELETE(request: Request, { params }: Params) {
  return withApiRoute(request, { permission: "team:manage", rateLimit: GENERAL_WRITE_LIMIT }, async ({ session }) => {
    const { id } = await params;
    await deleteIdentityTemplate(id);
    await auditUserAction(session.userId, "identity_template.delete", { templateId: id }, "WARNING");
    return NextResponse.json({ success: true });
  });
}
