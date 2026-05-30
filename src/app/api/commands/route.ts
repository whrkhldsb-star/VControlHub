import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { cancelCommandRequest, createCommandRequest, listCommandRequests, recoverStaleRunningCommandRequests } from "@/lib/command/service";
import { createCommandSchema } from "@/lib/command/schema";
import { withApiRoute } from "@/lib/http/api-guard";
import { COMMAND_LIMIT } from "@/lib/http/rate-limit-presets";
import { auditUserAction } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(request, { requireAuth: true }, async ({ session }) => {
    if (!session || !sessionHasPermission(session, "command:read")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
    await recoverStaleRunningCommandRequests();
    return NextResponse.json({ requests: await listCommandRequests() });
  });
}

export async function POST(request: Request) {
  return withApiRoute(request, { requireAuth: true, rateLimit: COMMAND_LIMIT }, async ({ session }) => {
    if (!session || !sessionHasPermission(session, "command:create")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
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
  });
}

export async function PATCH(request: Request) {
  return withApiRoute(request, { requireAuth: true, rateLimit: COMMAND_LIMIT }, async ({ session }) => {
    if (!session || !sessionHasPermission(session, "command:execute")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
    const json = await request.json().catch(() => null);
    const action = String(json?.action ?? "");
    const commandRequestId = String(json?.commandRequestId ?? json?.id ?? "");
    if (action !== "cancel" || !commandRequestId) {
      return NextResponse.json({ error: "请求参数无效" }, { status: 400 });
    }

    const command = await cancelCommandRequest({
      commandRequestId,
      actorId: session.userId,
      reason: typeof json?.reason === "string" ? json.reason : undefined,
    });
    auditUserAction(session.userId, "command.cancel", {
      commandRequestId: command.id,
      status: command.status,
    });
    return NextResponse.json({ command });
  });
}
