/**
 * PATCH /api/ai/hosted-actions/[id]/approve — 审批通过
 * PATCH /api/ai/hosted-actions/[id]/reject — 审批拒绝
 */

import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/require-api-session";
import { approveHostedAction, rejectHostedAction } from "@/lib/ai/hosted-service";

export const dynamic = "force-dynamic";

export async function PATCH(
 request: Request,
 { params }: { params: Promise<{ id: string }> }
) {
 const authed = await requireApiSession();
 if (authed instanceof NextResponse) return authed;
 const { session } = authed;
 const { id } = await params;

 let body: { action: "approve" | "reject"; reason?: string };
 try {
  body = await request.json();
 } catch {
  return NextResponse.json({ error: "无效请求" }, { status: 400 });
 }

 try {
  if (body.action === "approve") {
   await approveHostedAction(id, session.userId);
   // 审批通过后自动执行，获取最新状态
   const { prisma } = await import("@/lib/db");
   const action = await prisma.aiHostedAction.findUnique({ where: { id } });
   return NextResponse.json({ success: true, action });
  } else {
   const result = await rejectHostedAction(id, session.userId, body.reason);
   return NextResponse.json({ success: true, action: result });
  }
 } catch (e) {
  const msg = e instanceof Error ? e.message : "操作失败";
  return NextResponse.json({ error: msg }, { status: 400 });
 }
}
