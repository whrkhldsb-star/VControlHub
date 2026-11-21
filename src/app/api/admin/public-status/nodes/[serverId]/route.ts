/** Public fields of one server's status board entry — platform administrators only. */
import { NextResponse } from "next/server";

import { assertPlatformAdmin } from "@/lib/auth/platform-admin-guard";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { apiCopy } from "@/lib/i18n/api-copy";
import { saveAuditedPublication } from "../../mutations";
import { nodePublicationSchema } from "@/lib/public-status/nodes-admin";
import { invalidatePublicStatusCache } from "@/lib/public-status/projection";
import { clearPublicHistoryCache } from "@/lib/public-status/read";

export const dynamic = "force-dynamic";

export async function PUT(request: Request, { params }: { params: Promise<{ serverId: string }> }) {
	return withApiRoute(
		request,
		{ permission: "team:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: nodePublicationSchema, errorMessage: apiCopy("apiCopy.publicStatus.saveFailed") },
		async ({ session, body }) => {
			assertPlatformAdmin(session);
			const { serverId } = await params;
			const saved = await saveAuditedPublication(serverId, body, session.userId);
			invalidatePublicStatusCache();
			clearPublicHistoryCache();
			return NextResponse.json({ publicId: saved.publicId, published: saved.published });
		},
	);
}
