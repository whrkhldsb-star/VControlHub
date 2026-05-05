import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { createCommandRequest, listCommandRequests } from "@/lib/command/service";
import { createCommandSchema } from "@/lib/command/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!sessionHasPermission(session, "command:read")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  return NextResponse.json({ requests: await listCommandRequests() });
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!sessionHasPermission(session, "command:create")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  const json = await request.json().catch(() => null);
  const parsed = createCommandSchema.safeParse({ ...json, requesterId: session.userId, submissionMode: json?.submissionMode ?? "user" });
  if (!parsed.success) return NextResponse.json({ error: "请求参数无效", issues: parsed.error.flatten() }, { status: 400 });
  const command = await createCommandRequest(parsed.data);
  return NextResponse.json({ command }, { status: 201 });
}
