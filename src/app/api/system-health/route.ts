import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { collectSystemHealthChecks } from "@/lib/system-health/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!sessionHasPermission(session, "health:read")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  return NextResponse.json(await collectSystemHealthChecks());
}
