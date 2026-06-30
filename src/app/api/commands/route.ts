import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { cancelCommandRequest, createCommandRequest, listCommandRequests, recoverStaleRunningCommandRequests } from "@/lib/command/service";
import { createCommandSchema } from "@/lib/command/schema";
import { withApiRoute } from "@/lib/http/api-guard";
import { COMMAND_LIMIT } from "@/lib/http/rate-limit-presets";
import { auditUserAction } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

const submitCommandRequestBodySchema = createCommandSchema
  .omit({ requesterId: true, submissionMode: true })
  .extend({ submissionMode: z.enum(["user", "assistant"]).optional() });

const cancelCommandRequestBodySchema = z.object({
  action: z.literal("cancel"),
  commandRequestId: z.string().trim().min(1, "命令请求不能为空").optional(),
  id: z.string().trim().min(1, "命令请求不能为空").optional(),
  reason: z.string().trim().max(500, "取消原因最多 500 个字符").optional(),
}).refine((body) => Boolean(body.commandRequestId ?? body.id), {
  message: "命令请求不能为空",
  path: ["commandRequestId"],
});

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "command:read" }, async () => {
    await recoverStaleRunningCommandRequests();
    return NextResponse.json({ requests: await listCommandRequests() });
  });
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    { permission: "command:create", rateLimit: COMMAND_LIMIT, bodySchema: submitCommandRequestBodySchema },
    async ({ session, body }) => {
      const parsed = createCommandSchema.parse({
        ...body,
        requesterId: session!.userId,
        submissionMode: body.submissionMode ?? "user",
      });
      if (parsed.submissionMode === "user" && !sessionHasPermission(session!, "command:execute")) {
        parsed.submissionMode = "assistant";
      }
      const command = await createCommandRequest(parsed);
      auditUserAction(session!.userId, "command.submit", {
        commandRequestId: command.id,
        title: command.title,
        status: command.status,
        targetCount: parsed.serverIds.length,
        requiresApproval: Boolean(command.requiresApproval),
        submissionMode: parsed.submissionMode,
      });
      return NextResponse.json({ command }, { status: 201 });
    },
  );
}

export async function PATCH(request: Request) {
  return withApiRoute(
    request,
    { permission: "command:execute", rateLimit: COMMAND_LIMIT, bodySchema: cancelCommandRequestBodySchema },
    async ({ session, body }) => {
      const commandRequestId = body.commandRequestId ?? body.id!;
      const command = await cancelCommandRequest({
        commandRequestId,
        actorId: session!.userId,
        reason: body.reason,
      });
      auditUserAction(session!.userId, "command.cancel", {
        commandRequestId: command.id,
        status: command.status,
      });
      return NextResponse.json({ command });
    },
  );
}
