/**
 * GET /api/ai/hosted-actions — 获取待审批的 AI 托管操作
 * POST /api/ai/hosted-actions — 创建托管操作（内部调用，AI chat route 使用）
 */

import { NextResponse } from "next/server";

import { getPendingActions } from "@/lib/ai/hosted-service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "ai:chat", rateLimit: GENERAL_READ_LIMIT }, async ({ session }) => {
    const actions = await getPendingActions(session);
    return NextResponse.json({ actions });
  });
}
