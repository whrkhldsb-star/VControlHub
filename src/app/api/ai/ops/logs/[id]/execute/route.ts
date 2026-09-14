import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * TR-032 E02: /api/ai/ops/logs/[id]/execute — execute a recommended action.
 *
 * POST { actionId: string, forceAutonomous?: boolean }
 *   → { result: ExecuteRecommendationResult }
 *   Permission:
 *     - normal execute: ai:ops:manage
 *     - forceAutonomous=true: additionally requires ai:ops:autonomous
 *
 * The service layer never bypasses the autonomous safe-set gate, even
 * when forceAutonomous=true. Actions outside the safe set are recorded
 * as `executed: false` with an explanatory errorMessage.
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { executeRecommendationSchema } from "@/lib/ai/ops/schema";
import { executeRecommendation } from "@/lib/ai/ops/service";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { auditUserAction } from "@/lib/audit/service";
import { ForbiddenError } from "@/lib/errors";

export const dynamic = "force-dynamic";

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
			bodySchema: executeRecommendationSchema,
			errorStatus: 500,
			errorMessage: apiCopy("apiCopy.failed.to.execute.recommendation.b113d006"),
		},
		async ({ session, body }) => {
			if (!session) {
				throw new ForbiddenError(apiCopy("apiCopy.not.authenticated.or.session.expired.b1714d99"));
			}
			if (body.forceAutonomous && !sessionHasPermission(session, "ai:ops:autonomous")) {
				throw new ForbiddenError(apiCopy("apiCopy.forceautonomous.requires.ai.ops.autonomous.permission.9466ebc3"));
			}
			const result = await executeRecommendation({
				logId: id,
				actionId: body.actionId,
				forceAutonomous: body.forceAutonomous,
			});
			await auditUserAction(
				session?.userId ?? "anonymous",
				"ai.ops.recommendation.execute",
				{
					logId: id,
					actionId: body.actionId,
					forceAutonomous: body.forceAutonomous ?? false,
					ok: result.ok,
					executed: result.executed,
					errorMessage: result.errorMessage ?? null,
				},
			undefined, session?.currentTeamId);
			return NextResponse.json({ result });
		},
	);
}
