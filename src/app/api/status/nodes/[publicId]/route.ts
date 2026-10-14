import { withApiRoute } from "@/lib/http/api-guard";
import { apiCopy } from "@/lib/i18n/api-copy";
import { PUBLIC_STATUS_RATE_LIMIT, previewAllowed, publicJson, publicNotFound } from "@/lib/public-status/http";
import { readPublicNode } from "@/lib/public-status/read";

export const dynamic = "force-dynamic";
// guardMode: public

/** One published node with availability; 404 for hidden, unpublished or unknown ids. */
export async function GET(request: Request, { params }: { params: Promise<{ publicId: string }> }) {
	return withApiRoute(request, { rateLimit: PUBLIC_STATUS_RATE_LIMIT, errorMessage: apiCopy("apiCopy.publicStatus.loadFailed") }, async () => {
		const { publicId } = await params;
		const detail = await readPublicNode(publicId, { preview: await previewAllowed(request) });
		return detail ? publicJson(detail) : publicNotFound();
	});
}
