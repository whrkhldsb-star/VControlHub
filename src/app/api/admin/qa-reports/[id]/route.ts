/**
 * GET /api/admin/qa-reports/[id]
 *
 * TR-029: returns the full evidence payload for a single QA report
 * selected by its colon-prefixed composite id (e.g. `slice:media-…`,
 * `blocker:quick-services-docker-canary:2026-06-03T…Z`,
 * `qa_run:backups-create-form-visible-labels`).
 *
 * Returns 404 with a TR-034 envelope when the id is not present in
 * any of the underlying sources. The handler is read-only and shares
 * the same `task:read` permission as the list endpoint.
 */
import { NextResponse } from "next/server";

import { NotFoundError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { getQaReportDetail } from "@/lib/qa-reports/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withApiRoute(
    request,
    { permission: "task:read", errorMessage: "Failed to fetch QA report detail" },
    async () => {
      const detail = await getQaReportDetail(id);
      if (!detail) {
        throw new NotFoundError(`QA report not found: ${id}`);
      }
      return NextResponse.json(detail, { status: 200 });
    },
  );
}
