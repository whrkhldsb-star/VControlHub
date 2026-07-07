/**
 * TR-032 E02: /api/ai/ops/summary — counts by status / mode + last scan info.
 *
 * GET → { summary: AiOpsSummary }
 *   Permission: ai:ops:read
 *
 * The summary is a thin wrapper over `summariseAiOps()` so the UI can
 * keep the four cards on the dashboard fresh without re-reading the
 * full log list.
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { summariseAiOps } from "@/lib/ai/ops/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	return withApiRoute(
		request,
		{
			permission: "ai:ops:read",
			rateLimit: GENERAL_WRITE_LIMIT,
			errorStatus: 500,
			errorMessage: "Failed to load AI ops summary",
		},
		async () => {
			const summary = await summariseAiOps();
			return NextResponse.json({ summary });
		},
	);
}
