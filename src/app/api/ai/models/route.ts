import { NextResponse } from "next/server";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { fetchModelsFromProvider } from "@/lib/ai/service";
import { aiModelsQuerySchema } from "@/lib/ai/schema";
import { AuthError } from "@/lib/errors";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/models?providerId=xxx
 * Fetches available models from a provider's API.
 */
export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "ai:chat", errorStatus: 400, errorMessage: "Failed to fetch model list" },
    async ({ session }) => {
      if (!session)
        throw new AuthError("Not authenticated");

      const { providerId } = parseSearchParams(request, aiModelsQuerySchema);

      const models = await fetchModelsFromProvider(providerId, session.userId);
      return NextResponse.json({ models });
    },
  );
}
