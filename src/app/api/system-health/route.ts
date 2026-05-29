import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { collectSystemHealthChecks } from "@/lib/system-health/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    if (!sessionHasPermission(session, "health:read")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
    return NextResponse.json(await collectSystemHealthChecks());
  } catch (error) {
    const msg = error instanceof Error ? error.message : "操作失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
