import { NextResponse } from "next/server";
import { auditUserAction } from "@/lib/audit/service";

import {
  createProvider,
  listProviders,
  serializeProvider,
} from "@/lib/ai/service";
import { createProviderSchema, PROVIDER_REQUEST_MAX_BODY_BYTES } from "@/lib/ai/schema";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "ai:manage" }, async ({ session }) => {
    const providers = await listProviders(session.userId);
    return NextResponse.json({ providers: providers.map(serializeProvider) });
  });
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    { permission: "ai:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: createProviderSchema, maxBodyBytes: PROVIDER_REQUEST_MAX_BODY_BYTES },
    async ({ session, body }) => {
      const provider = await createProvider({
        ...body,
        createdBy: session.userId,
      });
      await auditUserAction(session.userId, "ai.provider.create", { providerId: provider.id }, undefined, session.roles?.includes("admin") ? null : session.currentTeamId);
      return NextResponse.json(
        { provider: serializeProvider(provider) },
        { status: 201 },
      );
    },
  );
}
