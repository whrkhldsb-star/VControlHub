/**
 * TR-032 E02: /api/ai/ops/scan — manually trigger an AI ops scan.
 *
 * POST { notes?: string }
 *   → { triggered: boolean, latestLog: AiOpsLogRecord | null }
 *   Permission: ai:ops:manage
 *
 * The scan runs synchronously through the durable-job worker so the
 * caller gets the resulting log row in the response. If a previous
 * tick is still running the worker skips the work and returns
 * `triggered: false`.
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { triggerAiOpsScanSchema } from "@/lib/ai/ops/schema";
import { listAiOpsLogs } from "@/lib/ai/ops/service";
import { runAiOpsScanWorkerOnce } from "@/lib/ai/ops/scan-worker";
import { auditUserAction } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	return withApiRoute(
		request,
		{
			permission: "ai:ops:manage",
			rateLimit: GENERAL_WRITE_LIMIT,
			bodySchema: triggerAiOpsScanSchema,
			errorStatus: 500,
			errorMessage: "Failed to trigger scan",
		},
		async ({ session, body }) => {
			const triggered = await runAiOpsScanWorkerOnce("manual");
			const latest = await listAiOpsLogs({ limit: 1 });
			auditUserAction(
				session?.userId ?? "anonymous",
				"ai.ops.scan.manual",
				{
					triggered,
					logId: latest[0]?.id ?? null,
					notes: body.notes ?? null,
				},
			);
			return NextResponse.json({ triggered, latestLog: latest[0] ?? null });
		},
	);
}
