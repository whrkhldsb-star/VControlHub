/**
 * PATCH /api/ai/hosted-actions/[id] — approve or reject an AI hosted action
 *
 * Permission rules:
 * - The original requester can always approve/reject their own action
 * - Users with `ai:action:approve` permission can approve/reject any action (admin override)
 */

import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/require-api-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { approveHostedAction, rejectHostedAction } from "@/lib/ai/hosted-service";
import { withRateLimit, rateLimitResponse, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

export async function PATCH(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
	if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
	try {
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

		// Check permission: requester can always approve own action;
		// ai:action:approve grants admin override for others' actions
		const hasAdminApprove = sessionHasPermission(session, "ai:action:approve");

		if (body.action === "approve") {
			await approveHostedAction(id, session.userId, hasAdminApprove);
			const { prisma } = await import("@/lib/db");
			const action = await prisma.aiHostedAction.findUnique({ where: { id } });
			return NextResponse.json({ success: true, action });
		} else {
			const result = await rejectHostedAction(id, session.userId, body.reason, hasAdminApprove);
			return NextResponse.json({ success: true, action: result });
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : "操作失败";
		return NextResponse.json({ error: msg }, { status: 400 });
	}
}
