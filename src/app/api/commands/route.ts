import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { createCommandRequest, listCommandRequests } from "@/lib/command/service";
import { createCommandSchema } from "@/lib/command/schema";
import { withRateLimit, rateLimitResponse, COMMAND_LIMIT } from "@/lib/http/rate-limit-presets";
import { auditUserAction } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!sessionHasPermission(session, "command:read")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  return NextResponse.json({ requests: await listCommandRequests() });
}

export async function POST(request: Request) {
  const rl = withRateLimit(request, COMMAND_LIMIT);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
  try {
    const session = await requireSession();
    if (!sessionHasPermission(session, "command:create")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
    const json = await request.json().catch(() => null);
    const parsed = createCommandSchema.safeParse({ ...json, requesterId: session.userId, submissionMode: json?.submissionMode ?? "user" });
    if (!parsed.success) return NextResponse.json({ error: "请求参数无效", issues: parsed.error.flatten() }, { status: 400 });
    if (parsed.data.submissionMode === "user" && !sessionHasPermission(session, "command:execute")) {
      parsed.data.submissionMode = "assistant";
    }
    const command = await createCommandRequest(parsed.data);
    auditUserAction(session.userId, "command.submit", {
      commandRequestId: command.id,
      title: command.title,
      status: command.status,
      targetCount: parsed.data.serverIds.length,
      requiresApproval: Boolean(command.requiresApproval),
      submissionMode: parsed.data.submissionMode,
    });
    return NextResponse.json({ command }, { status: 201 });
  } catch (error) {
  	const message = error instanceof Error ? error.message : "操作失败";
  	return NextResponse.json({ error: message }, { status: 500 });
  }
}
