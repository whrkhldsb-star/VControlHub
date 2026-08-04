/**
 * FEAT-P0-4: File content search API.
 *
 * GET /api/files/search-content?q=keyword&nodeId=xxx&path=subdir
 *
 * Searches file *contents* across LOCAL and SFTP storage nodes.
 * Returns matching files with line snippets.
 */
import { NextRequest, NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { AuthError } from "@/lib/errors";
import { searchFileContents } from "@/lib/files/content-search";
import { searchFileContentQuerySchema } from "@/lib/files/schema";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
	return withApiRoute(
		req,
		{ permission: "storage:read", errorMessage: "Content search failed" },
		async ({ session }) => {
			if (!session) throw new AuthError("Unauthorized");

			const { q, nodeId, path: searchPath } = parseSearchParams(
				req,
				searchFileContentQuerySchema,
			);

			const response = await searchFileContents({
				query: q,
				nodeId,
				searchPath,
				session,
			});

			return NextResponse.json(response);
		},
	);
}
