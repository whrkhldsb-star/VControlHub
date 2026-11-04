import { apiCopy } from "@/lib/i18n/api-copy";
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
import { requestAiOpsScan } from "@/lib/ai/ops/scan-worker";
import { auditUserAction } from "@/lib/audit/service";
import { assertAiOpsPlatformReader } from "@/lib/ai/ops/authorization";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	return withApiRoute(
		request,
		{
			permission: "ai:ops:manage",
			rateLimit: GENERAL_WRITE_LIMIT,
			bodySchema: triggerAiOpsScanSchema,
			errorStatus: 500,
			errorMessage: apiCopy("apiCopy.failed.to.trigger.scan.c41a3220"),
		},
		async ({ session, body }) => {
			assertAiOpsPlatformReader(session);
			// Queued, not run here (A7-04): the scan calls the provider (up to 90 s)
			// and aggregates the fleet; inside the web request it outlived the proxy
			// timeout and ran in a process whose workers are switched off.
			const job = await requestAiOpsScan("manual", body.notes ?? null);
			const latest = await listAiOpsLogs({ limit: 1 });
			await auditUserAction(
				session.userId,
				"ai.ops.scan.manual",
				{
					triggered: job !== null,
					jobId: job?.id ?? null,
					notes: body.notes ?? null,
				},
			undefined, session.currentTeamId);
			return NextResponse.json({ triggered: job !== null, queued: job !== null, jobId: job?.id ?? null, latestLog: latest[0] ?? null }, { status: job ? 202 : 200 });
		},
	);
}
