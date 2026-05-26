import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth/require-api-permission";
import { fetchModelsFromCredentials } from "@/lib/ai/service";
import { withRateLimit, rateLimitResponse, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

const probeModelsSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
  defaultModel: z.string().optional(),
});

export async function POST(request: Request) {
  const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  try {
    const authed = await requireApiPermission("ai:manage");
    if (authed instanceof NextResponse) return authed;

    const body = await request.json();
    const parsed = probeModelsSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "输入参数无效" }, { status: 400 });

    const models = await fetchModelsFromCredentials(parsed.data);
    return NextResponse.json({ models });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "获取模型列表失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
