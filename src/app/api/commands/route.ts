import { apiCopy } from "@/lib/i18n/api-copy";
import type { CommandOrigin } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { canReadCommandBody } from "@/lib/command/visibility";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { cancelCommandRequest, createCommandRequest, listCommandRequestPage, type CommandRequestListFilter } from "@/lib/command/service";
import { createCommandSchema } from "@/lib/command/schema";
import { ForbiddenError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { COMMAND_LIMIT } from "@/lib/http/rate-limit-presets";
import { auditUserAction } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

const submitCommandRequestBodySchema = createCommandSchema
  .omit({ requesterId: true, submissionMode: true })
  .extend({ submissionMode: z.enum(["user", "assistant"]).optional() });

const cancelCommandRequestBodySchema = z.object({
  action: z.literal("cancel"),
  commandRequestId: z.string().trim().min(1, "Command request is required").optional(),
  id: z.string().trim().min(1, "Command request is required").optional(),
  reason: z.string().trim().max(500, "Cancellation reason must be at most 500 characters").optional(),
}).refine((body) => Boolean(body.commandRequestId ?? body.id), {
  message: "Command request is required",
  path: ["commandRequestId"],
});

const ALLOWED_LIST_FILTERS = new Set<CommandRequestListFilter>(["waiting_on_me", "my_submissions", "open", "history", "all"]);
const ALLOWED_ORIGINS = new Set<CommandOrigin>(["USER_UI", "AI_CHAT", "AI_AUTOMATION", "DEPLOYMENT", "DEPLOYMENT_ROLLBACK", "SCHEDULED_TASK", "PLAYBOOK", "API"]);

export async function GET(request: Request) {
  // The stale-RUNNING sweep belongs to the maintenance worker (A6-08): running
  // it on every list load made each refresh of the approval page a write path.
  return withApiRoute(request, { permission: "command:read", optionalTokenPermissions: ["server:read", "command:approve"] }, async (ctx) => {
    // The approvals page shows a command's text to reviewers and to whoever submitted it; this list gave every
    // reader all of them. Someone else's text is left out here too.
    const canApprove = sessionHasPermission(ctx.session, "command:approve");
    const params = new URL(request.url).searchParams;
    const cursor = params.get("cursor") || undefined;
    const rawFilter = params.get("filter") === "all_open" ? "open" : (params.get("filter") || undefined);
    const rawOrigin = params.get("origin") || undefined;
    const filter = rawFilter && ALLOWED_LIST_FILTERS.has(rawFilter as CommandRequestListFilter)
      ? (rawFilter as CommandRequestListFilter)
      : undefined;
    const origin = rawOrigin && ALLOWED_ORIGINS.has(rawOrigin as CommandOrigin)
      ? (rawOrigin as CommandOrigin)
      : undefined;
    const page = filter || origin
      ? await listCommandRequestPage(ctx.session, cursor, undefined, { filter, origin })
      : await listCommandRequestPage(ctx.session, cursor);
    const requests = page.requests.map((item) =>
      canReadCommandBody(ctx.session.userId, item.requesterId, canApprove) ? item : { ...item, command: "", commandHidden: true });
    return NextResponse.json({ ...page, requests });
  });
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    { permission: "command:create", optionalTokenPermissions: ["command:execute"], rateLimit: COMMAND_LIMIT, bodySchema: submitCommandRequestBodySchema },
    async ({ session, body }) => {
      const parsed = createCommandSchema.parse({
        ...body,
        requesterId: session.userId,
        submissionMode: body.submissionMode ?? "user",
      });
      const executesWithoutApproval =
        parsed.approvalRequired === false ||
        (parsed.approvalRequired === undefined && parsed.submissionMode === "user");
      if (executesWithoutApproval && !sessionHasPermission(session, "command:execute")) {
        throw new ForbiddenError(
          apiCopy("apiCopy.command.execute.permission.is.required.for.submissions.that.bypa.123f619f"),
        );
      }
      const command = await createCommandRequest(parsed, session, "api");
      await auditUserAction(session.userId, "command.submit", {
        commandRequestId: command.id,
        title: command.title,
        status: command.status,
        targetCount: parsed.serverIds.length,
        requiresApproval: Boolean(command.requiresApproval),
        submissionMode: parsed.submissionMode,
      }, undefined, session.currentTeamId);
      const {
        id,
        title,
        reason,
        status,
        requesterId,
        initiatedByType,
        origin,
        riskLevel,
        riskReasons,
        decisionSource,
        createdAt,
        updatedAt,
        targets,
        requiresApproval,
      } = command;
      return NextResponse.json({ command: {
        id, title, command: command.command, reason, status, requesterId, initiatedByType,
        origin, riskLevel, riskReasons, decisionSource,
        createdAt, updatedAt, targets, requiresApproval,
      } }, { status: 201 });
    },
  );
}

export async function PATCH(request: Request) {
  return withApiRoute(
    request,
    // A submitter withdraws their own pending request; cancelCommandRequest decides what each may stop.
    { permissions: ["command:execute", "command:create"], optionalTokenPermissions: ["command:approve"], rateLimit: COMMAND_LIMIT, bodySchema: cancelCommandRequestBodySchema },
    async ({ session, body }) => {
      const commandRequestId = body.commandRequestId ?? body.id!;
      const command = await cancelCommandRequest({
        commandRequestId,
        actorId: session.userId,
        reason: body.reason,
        session: session,
      });
      await auditUserAction(session.userId, "command.cancel", {
        commandRequestId: command.id,
        status: command.status,
      }, undefined, session.currentTeamId);
      return NextResponse.json({ command });
    },
  );
}
