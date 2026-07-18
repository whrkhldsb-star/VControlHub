import { NextResponse } from "next/server";

import { listAuditLogs } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import {
  paginationQuerySchema,
  parseSearchParams,
} from "@/lib/http/parse-search-params";
import { z } from "zod";

export const dynamic = "force-dynamic";

const auditQuerySchema = paginationQuerySchema.extend({
  action: z.string().trim().min(1).optional(),
  severity: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
});

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "audit:read" }, async ({ session }) => {
    const { page, pageSize, action, severity, search } = parseSearchParams(
      request,
      auditQuerySchema,
    );

    const result = await listAuditLogs({
      page,
      pageSize,
      action,
      severity,
      search,
      session,
    });
    return NextResponse.json(result);
  });
}
