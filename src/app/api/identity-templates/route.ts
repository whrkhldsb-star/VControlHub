import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { createIdentityTemplate, identityTemplateInputSchema, listIdentityTemplates } from "@/lib/auth/identity-template-service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "team:manage" }, async () =>
    NextResponse.json({ templates: await listIdentityTemplates() }),
  );
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    { permission: "team:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: identityTemplateInputSchema },
    async ({ session, body }) => {
      const template = await createIdentityTemplate(body, session.userId);
      await auditUserAction(session.userId, "identity_template.create", { templateId: template.id, name: template.name });
      return NextResponse.json({ template }, { status: 201 });
    },
  );
}
