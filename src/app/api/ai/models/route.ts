import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { fetchModelsFromProvider } from "@/lib/ai/service";
import { aiModelsQuerySchema } from "@/lib/ai/schema";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/models?providerId=xxx
 * Fetches available models from a provider's API.
 */
export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "ai:chat", errorStatus: 400, errorMessage: apiCopy("apiCopy.failed.to.fetch.model.list.d5934edd") },
    async ({ session }) => {
      const { providerId } = parseSearchParams(request, aiModelsQuerySchema);

      const models = await fetchModelsFromProvider(providerId, session.userId);
      return NextResponse.json({ models });
    },
  );
}
