import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { recordWebVital, type WebVitalName } from "@/lib/monitoring/runtime-metrics";

export const dynamic = "force-dynamic";

const webVitalSchema = z.object({
	name: z.enum(["CLS", "LCP", "INP", "FCP", "TTFB"]),
	value: z.number().finite(),
	rating: z.enum(["good", "needs-improvement", "poor"]).optional(),
	path: z.string().max(200).optional(),
	navigationType: z.string().max(40).optional(),
});

/**
 * Accepts browser Web Vital samples from authenticated sessions.
 * Stored in-process for the observability snapshot endpoint.
 */
export async function POST(request: Request) {
	return withApiRoute(
		request,
		{
			requireAuth: true,
			rateLimit: GENERAL_WRITE_LIMIT,
			bodySchema: webVitalSchema,
			errorMessage: "Failed to record web vital",
		},
		async ({ body }) => {
			recordWebVital({
				name: body.name as WebVitalName,
				value: body.value,
				rating: body.rating,
				path: body.path,
				navigationType: body.navigationType,
			});
			return NextResponse.json({ ok: true });
		},
	);
}
