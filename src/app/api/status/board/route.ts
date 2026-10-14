import { withApiRoute } from "@/lib/http/api-guard";
import { apiCopy } from "@/lib/i18n/api-copy";
import { PUBLIC_STATUS_RATE_LIMIT, previewAllowed, publicJson, publicNotFound } from "@/lib/public-status/http";
import { parseBoardQuery } from "@/lib/public-status/query";
import { readPublicBoard } from "@/lib/public-status/read";

export const dynamic = "force-dynamic";
// guardMode: public

/**
 * Anonymous status board: site text, fleet summary and one page of published
 * nodes. Reads stored samples only; never probes hosts.
 */
export async function GET(request: Request) {
	return withApiRoute(request, { rateLimit: PUBLIC_STATUS_RATE_LIMIT, errorMessage: apiCopy("apiCopy.publicStatus.loadFailed") }, async () => {
		const query = parseBoardQuery(new URL(request.url).searchParams);
		const board = await readPublicBoard(query, { preview: await previewAllowed(request) });
		return board ? publicJson(board) : publicNotFound();
	});
}
