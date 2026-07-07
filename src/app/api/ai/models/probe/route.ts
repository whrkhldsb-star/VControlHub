import { NextResponse } from "next/server";

import { fetchModelsFromCredentials } from "@/lib/ai/service";
import { probeModelsSchema } from "@/lib/ai/schema";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "ai:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorStatus: 400,
      errorMessage: "Failed to fetch model list",
      bodySchema: probeModelsSchema,
    },
    async ({ body }) => {
      const models = await fetchModelsFromCredentials(body);
      return NextResponse.json({ models });
    },
  );
}
