import { NextResponse } from "next/server";
import { auditUserAction } from "@/lib/audit/service";

import {
  createProvider,
  listProviders,
  serializeProvider,
} from "@/lib/ai/service";
import { createProviderSchema } from "@/lib/ai/schema";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

import { AuthError } from "@/lib/errors";
export const dynamic = "force-dynamic";

function parseModels(data: { availableModels?: string[]; models?: string }) {
  const rawModels = data.availableModels ?? data.models?.split(",") ?? [];
  return Array.from(
    new Set(rawModels.map((model) => model.trim()).filter(Boolean)),
  );
}

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "ai:manage" }, async ({ session }) => {
    if (!session)
      throw new AuthError("Not authenticated");
    const providers = await listProviders(session.userId);
    return NextResponse.json({ providers: providers.map(serializeProvider) });
  });
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    { permission: "ai:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: createProviderSchema },
    async ({ session, body }) => {
      if (!session)
        throw new AuthError("Not authenticated");

      const provider = await createProvider({
        ...body,
        availableModels: parseModels(body),
        createdBy: session.userId,
      });
      await auditUserAction(session.userId, "ai.provider.create", { providerId: provider.id }, undefined, session?.currentTeamId);
      return NextResponse.json(
        { provider: serializeProvider(provider) },
        { status: 201 },
      );
    },
  );
}
