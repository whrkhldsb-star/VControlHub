/**
 * Node publication list and batch actions — platform administrators only.
 * Every server is private until published here with an explicit public name.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { assertPlatformAdmin } from "@/lib/auth/platform-admin-guard";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { apiCopy } from "@/lib/i18n/api-copy";
import { applyNodeBatch, listAdminNodes, nodeBatchSchema } from "@/lib/public-status/nodes-admin";
import { invalidatePublicStatusCache } from "@/lib/public-status/projection";
import { clearPublicHistoryCache } from "@/lib/public-status/read";

export const dynamic = "force-dynamic";

const listQuerySchema = z.object({
	q: z.string().max(100).optional().default(""),
	filter: z.enum(["all", "published", "unpublished", "attention"]).optional().default("all"),
	page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
	pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export async function GET(request: Request) {
	return withApiRoute(
		request,
		{ permission: "team:manage", rateLimit: GENERAL_READ_LIMIT, querySchema: listQuerySchema, errorMessage: apiCopy("apiCopy.publicStatus.loadFailed") },
		async ({ session, query }) => {
			assertPlatformAdmin(session);
			const result = await listAdminNodes(query);
			return NextResponse.json({ ...result, page: query.page, pageSize: query.pageSize });
		},
	);
}

export async function POST(request: Request) {
	return withApiRoute(
		request,
		{ permission: "team:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: nodeBatchSchema, errorMessage: apiCopy("apiCopy.publicStatus.saveFailed") },
		async ({ session, body }) => {
			assertPlatformAdmin(session);
			const result = await applyNodeBatch(body, session.userId);
			invalidatePublicStatusCache();
			clearPublicHistoryCache();
			await auditUserAction(session.userId, `public_status.nodes.${body.action}`, {
				serverIds: body.serverIds.slice(0, 200),
				changed: result.changed,
				skipped: result.skipped.slice(0, 200),
			}, body.action === "publish" ? "WARNING" : "INFO");
			return NextResponse.json(result);
		},
	);
}
