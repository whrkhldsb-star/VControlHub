import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";
import { getPublicStatus, getPublicStatusSummary } from "@/lib/status/service";
import { getApiSession } from "@/lib/auth/api-session";
import { isGlobalTeamManager } from "@/lib/auth/team-scope";
import { withApiRoute } from "@/lib/http/api-guard";
import { CachePresets, withCacheHeaders } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	return withApiRoute(request, { errorMessage: apiCopy("apiCopy.failed.to.fetch.status.6d03908a") }, async () => {
		const session = await getApiSession();
		// TR-053: 公开端点（未登录）只返 overall；详细 checks 仅登录用户可见。
		// The detail counts every customer's servers and storage nodes: for the platform's administrators only.
		const payload = session && isGlobalTeamManager(session) ? await getPublicStatus() : await getPublicStatusSummary();
		return withCacheHeaders(NextResponse.json(payload), session ? CachePresets.noStore : CachePresets.longLivedPublic);
	});
}
