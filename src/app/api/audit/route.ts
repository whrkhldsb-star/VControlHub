import { NextResponse } from "next/server";

import { listAuditLogs } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "audit:read" }, async () => {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
    const pageSize = Math.min(
      100,
      Math.max(1, Number(searchParams.get("pageSize") ?? "50")),
    );
    const action = searchParams.get("action") ?? undefined;
    const severity = searchParams.get("severity") ?? undefined;
    const search = searchParams.get("search") ?? undefined;

    const result = await listAuditLogs({
      page,
      pageSize,
      action,
      severity,
      search,
    });
    return NextResponse.json(result);
  });
}
