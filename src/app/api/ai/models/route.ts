import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/require-api-permission";
import { fetchModelsFromProvider } from "@/lib/ai/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/models?providerId=xxx
 * Fetches available models from a provider's API
 */
export async function GET(request: Request) {
  try {
    const authed = await requireApiPermission("ai:manage");
	if (authed instanceof NextResponse) return authed;
	const { session } = authed;

    const providerId = new URL(request.url).searchParams.get("providerId");
    if (!providerId)
      return NextResponse.json({ error: "缺少 providerId" }, { status: 400 });

    const models = await fetchModelsFromProvider(providerId, session.userId);
    return NextResponse.json({ models });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "获取模型列表失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
