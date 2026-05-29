/**
 * GET /api/ai/hosted-actions — 获取待审批的 AI 托管操作
 * POST /api/ai/hosted-actions — 创建托管操作（内部调用，AI chat route 使用）
 */

import { NextResponse } from "next/server";

import { getPendingActions } from "@/lib/ai/hosted-service";
import { withApiRoute } from "@/lib/http/api-guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(request, { requireAuth: true }, async ({ session }) => {
    if (!session)
      return NextResponse.json({ error: "未认证" }, { status: 401 });
    const actions = await getPendingActions(session.userId);
    return NextResponse.json({ actions });
  });
}
