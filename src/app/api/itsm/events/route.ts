import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * GET /api/itsm/events — recent ITSM event log (ticket:manage)
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { GENERAL_READ_LIMIT } from "@/lib/http/rate-limit-presets";
import { listItsmEvents } from "@/lib/itsm/service";

export const dynamic = "force-dynamic";

/**
 * `limit` is validated instead of merely checked for finiteness. `Number("5.7")`
 * is finite, so the old code handed a fractional row count to Prisma `take` and
 * the caller got a 500; `?limit=-5` was finite too, and a negative `take` makes
 * Prisma page backwards from the oldest end instead of returning newest-first.
 * Both are now the same 400 every other list route returns.
 */
const eventsQuerySchema = z.object({
	connectionId: z.string().trim().min(1).optional(),
	ticketId: z.string().trim().min(1).optional(),
	limit: z.preprocess(
		(value) => (value === "" || value == null ? undefined : value),
		z.coerce.number().int().min(1).max(200).default(50),
	),
});

export async function GET(request: Request) {
	return withApiRoute(
		request,
		{
			permission: "ticket:manage",
			rateLimit: GENERAL_READ_LIMIT,
			errorStatus: 500,
			errorMessage: apiCopy("apiCopy.failed.to.list.itsm.events.18cabf07"),
		},
		async ({ session }) => {
			const { connectionId, ticketId, limit } = parseSearchParams(
				request,
				eventsQuerySchema,
			);
			const events = await listItsmEvents({
				connectionId,
				ticketId,
				limit,
				session,
			});
			return NextResponse.json({ events });
		},
	);
}
