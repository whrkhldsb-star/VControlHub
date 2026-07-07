/**
 * TR-032: /api/ai/ops/logs/[id]/approve — approve a recommended action.
 *
 * POST { actionId: string }
 *   → { result: { ok: boolean, errorMessage?: string } }
 *   Permission: ai:ops:manage
 *
 * After approval, the action can be executed without forceAutonomous.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { approveRecommendation } from "@/lib/ai/ops/service";
import { auditUserAction } from "@/lib/audit/service";
import { ForbiddenError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const approveSchema = z.object({
	actionId: z.string().min(1, "actionId is required"),
});

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;
	return withApiRoute(
		request,
		{
			permission: "ai:ops:manage",
			rateLimit: GENERAL_WRITE_LIMIT,
			bodySchema: approveSchema,
			errorStatus: 500,
			errorMessage: "Failed to approve recommendation",
		},
		async ({ session, body }) => {
			if (!session) {
				throw new ForbiddenError("Not authenticated or session expired");
			}
			const result = await approveRecommendation({
				logId: id,
				actionId: body.actionId,
			});
			auditUserAction(
				session?.userId ?? "anonymous",
				"ai.ops.recommendation.approve",
				{
					logId: id,
					actionId: body.actionId,
					ok: result.ok,
				},
			);
			return NextResponse.json({ result });
		},
	);
}
