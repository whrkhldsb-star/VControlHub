/**
 * Status board site settings — platform administrators only (`team:manage`
 * is platform-only, and the role is asserted again in the handler).
 */
import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { assertPlatformAdmin } from "@/lib/auth/platform-admin-guard";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { apiCopy } from "@/lib/i18n/api-copy";
import { invalidatePublicStatusCache } from "@/lib/public-status/projection";
import { clearPublicHistoryCache } from "@/lib/public-status/read";
import { loadPublicSite, savePublicSite } from "@/lib/public-status/site";
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
			const before = await loadPublicSite();
			const site = await savePublicSite(body, session.userId);
			invalidatePublicStatusCache();
			clearPublicHistoryCache();
			await auditUserAction(session.userId, "public_status.site.update", {
				enabledBefore: before.enabled,
				enabled: site.enabled,
				metrics: site.metrics,
				refreshSeconds: site.refreshSeconds,
				defaultView: site.defaultView,
			}, site.enabled !== before.enabled ? "WARNING" : "INFO");
			return NextResponse.json({ site });
		},
	);
}
