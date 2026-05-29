import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";

import { listAuditLogs } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!sessionHasPermission(session, "audit:read")) {
      return NextResponse.json({ error: "缺少权限" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "50")));
    const action = searchParams.get("action") ?? undefined;
    const severity = searchParams.get("severity") ?? undefined;
    const search = searchParams.get("search") ?? undefined;

    const result = await listAuditLogs({ page, pageSize, action, severity, search });
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "操作失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
