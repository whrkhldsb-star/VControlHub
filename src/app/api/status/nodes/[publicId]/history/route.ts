import { withApiRoute } from "@/lib/http/api-guard";
import { apiCopy } from "@/lib/i18n/api-copy";
import { PUBLIC_STATUS_RATE_LIMIT, previewAllowed, publicJson, publicNotFound } from "@/lib/public-status/http";
import { parseHistoryRange } from "@/lib/public-status/query";
import { readPublicHistory } from "@/lib/public-status/read";

export const dynamic = "force-dynamic";
// guardMode: public

/** Bucketed history (1h/6h/24h/7d, at most 360 points per series) of a published node. */
export async function GET(request: Request, { params }: { params: Promise<{ publicId: string }> }) {
	return withApiRoute(request, { rateLimit: PUBLIC_STATUS_RATE_LIMIT, errorMessage: apiCopy("apiCopy.publicStatus.loadFailed") }, async () => {
		const { publicId } = await params;
		const range = parseHistoryRange(new URL(request.url).searchParams.get("range"));
		const history = await readPublicHistory(publicId, range, { preview: await previewAllowed(request) });
		return history ? publicJson(history) : publicNotFound();
	});
}
