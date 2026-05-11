import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { listOperationTasks } from "@/lib/operation-task/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireSession();
  if (!sessionHasPermission(session, "task:read")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "100");
  return NextResponse.json({ tasks: await listOperationTasks({ limit: Math.min(Math.max(limit || 100, 1), 200) }) });
}
