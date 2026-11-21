/**
 * Status board site settings — platform administrators only (`team:manage`
 * is platform-only, and the role is asserted again in the handler).
 */
import { NextResponse } from "next/server";

import { assertPlatformAdmin } from "@/lib/auth/platform-admin-guard";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { apiCopy } from "@/lib/i18n/api-copy";
import { invalidatePublicStatusCache } from "@/lib/public-status/projection";
import { clearPublicHistoryCache } from "@/lib/public-status/read";
import { loadPublicSite } from "@/lib/public-status/site";
import { saveAuditedSite } from "../mutations";
import { publicSiteUpdateSchema } from "@/lib/public-status/site-config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	return withApiRoute(request, { permission: "team:manage", rateLimit: GENERAL_READ_LIMIT, errorMessage: apiCopy("apiCopy.publicStatus.loadFailed") }, async ({ session }) => {
		assertPlatformAdmin(session);
		return NextResponse.json({ site: await loadPublicSite() });
	});
}

export async function PUT(request: Request) {
	return withApiRoute(
		request,
		{ permission: "team:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: publicSiteUpdateSchema, errorMessage: apiCopy("apiCopy.publicStatus.saveFailed") },
		async ({ session, body }) => {
			assertPlatformAdmin(session);
			const site = await saveAuditedSite(body, session.userId);
			invalidatePublicStatusCache();
			clearPublicHistoryCache();
			return NextResponse.json({ site });
		},
	);
}
