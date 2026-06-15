import { NextResponse } from "next/server";

import { fetchModelsFromProvider } from "@/lib/ai/service";
import { withApiRoute } from "@/lib/http/api-guard";

import { AuthError, ValidationError } from "@/lib/errors";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/models?providerId=xxx
 * Fetches available models from a provider's API.
 */
export async function GET(request: Request) {
  return withApiRoute(
    request,
    { requireAuth: true, errorStatus: 400, errorMessage: "获取模型列表失败" },
    async ({ session }) => {
      if (!session)
        throw new AuthError("未认证");

      const providerId = new URL(request.url).searchParams.get("providerId");
      if (!providerId) {
        throw new ValidationError("缺少 providerId");
      }

      const models = await fetchModelsFromProvider(providerId, session.userId);
      return NextResponse.json({ models });
    },
  );
}
