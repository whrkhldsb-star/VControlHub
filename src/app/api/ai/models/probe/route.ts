import { NextResponse } from "next/server";
import { z } from "zod";

import { fetchModelsFromCredentials } from "@/lib/ai/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

const probeModelsSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
  defaultModel: z.string().optional(),
});

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "ai:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorStatus: 400,
      errorMessage: "获取模型列表失败",
    },
    async () => {
      const body = await request.json().catch(() => null);
      const parsed = probeModelsSchema.safeParse(body);
      if (!parsed.success)
        return NextResponse.json({ error: "输入参数无效" }, { status: 400 });

      const models = await fetchModelsFromCredentials(parsed.data);
      return NextResponse.json({ models });
    },
  );
}
