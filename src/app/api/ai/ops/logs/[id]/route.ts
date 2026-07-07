/**
 * TR-032 E02: /api/ai/ops/logs/[id] — get a single AI ops scan log.
 *
 * GET → { log: AiOpsLogRecord | null }
 *   Permission: ai:ops:read
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { getAiOpsLog } from "@/lib/ai/ops/service";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;
	return withApiRoute(
		request,
		{
			permission: "ai:ops:read",
			rateLimit: GENERAL_WRITE_LIMIT,
			errorStatus: 500,
			errorMessage: "Failed to load AI ops records",
		},
		async () => {
			const log = await getAiOpsLog(id);
			if (!log) {
				throw new NotFoundError(`AI ops record not found ${id}`);
			}
			return NextResponse.json({ log });
		},
	);
}
