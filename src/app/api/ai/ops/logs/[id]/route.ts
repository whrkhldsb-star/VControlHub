import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * TR-032 E02: /api/ai/ops/logs/[id] — get a single AI ops scan log.
 *
 * GET → { log: AiOpsLogRecord | null }
 *   Permission: ai:ops:read
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT } from "@/lib/http/rate-limit-presets";
import { getAiOpsLog } from "@/lib/ai/ops/service";
import { assertAiOpsPlatformReader } from "@/lib/ai/ops/authorization";
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
			rateLimit: GENERAL_READ_LIMIT,
			errorStatus: 500,
			errorMessage: apiCopy("apiCopy.failed.to.load.ai.ops.records.cf32bf1b"),
		},
		async ({ session }) => {
			assertAiOpsPlatformReader(session);
			const log = await getAiOpsLog(id);
			if (!log) {
				throw new NotFoundError(apiCopy("apiCopy.ai.ops.record.not.found.70e83060", { v0: String(id) }));
			}
			return NextResponse.json({ log });
		},
	);
}
