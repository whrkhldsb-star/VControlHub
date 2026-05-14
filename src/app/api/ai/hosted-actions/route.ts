/**
 * GET /api/ai/hosted-actions — 获取待审批的 AI 托管操作
 * POST /api/ai/hosted-actions — 创建托管操作（内部调用，AI chat route 使用）
 */

import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/require-api-session";
import { getPendingActions } from "@/lib/ai/hosted-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const authed = await requireApiSession();
  if (authed instanceof NextResponse) return authed;
  const { session } = authed;

  try {
    const actions = await getPendingActions(session.userId);
    return NextResponse.json({ actions });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "获取托管操作失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
