import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * GET / PATCH /api/ai/hosted-actions/[id]
 * - GET: poll live status + bounded masked output for requester's own hosted action.
 * - PATCH: confirm (inline execution or approval submission), approve, or reject.
 */

import { NextResponse } from "next/server";

import { getHostedActionLiveStatus } from "@/lib/ai/hosted-outcome";
import {
  approveHostedAction,
  confirmHostedAction,
  rejectHostedAction,
} from "@/lib/ai/hosted-service";
import { hostedActionDecisionSchema } from "@/lib/ai/schema";
import { NotFoundError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

import { auditUserAction } from "@/lib/audit/service";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "ai:chat",
      rateLimit: GENERAL_READ_LIMIT,
      errorStatus: 404,
      errorMessage: apiCopy("apiCopy.not.found.e3ebaa16"),
    },
    async ({ session }) => {
      const { id } = await params;
      const live = await getHostedActionLiveStatus(id, session);
      if (!live) {
        throw new NotFoundError(apiCopy("apiCopy.not.found.e3ebaa16"));
      }
      return NextResponse.json(live);
    },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "ai:chat",
      optionalTokenPermissions: ["ai:action:approve", "server:read", "server:ssh", "command:read", "command:create", "command:approve", "command:execute", "playbook:run", "health:read"],
      rateLimit: GENERAL_WRITE_LIMIT,
      errorStatus: 400,
      errorMessage: apiCopy("apiCopy.operation.failed.4e1af7c7"),
      bodySchema: hostedActionDecisionSchema,
    },
    async ({ session, body }) => {
      const { id } = await params;

      if (body.action === "confirm" || body.action === "approve") {
        const confirmOptions =
          body.editedCommand !== undefined || body.acknowledgeCritical !== undefined
            ? { editedCommand: body.editedCommand, acknowledgeCritical: body.acknowledgeCritical }
            : undefined;
        const decisionResult = body.action === "confirm"
          ? (confirmOptions ? await confirmHostedAction(id, session, confirmOptions) : await confirmHostedAction(id, session))
          : await approveHostedAction(id, session);
        await auditUserAction(
          session.userId,
          "ai.hosted-action.update",
          { actionId: id, decision: body.action },
          undefined,
          session.currentTeamId,
        );
        const { prisma } = await import("@/lib/db");
        const action = await prisma.aiHostedAction.findUnique({ where: { id } });
        if (!action || action.status === "FAILED" || action.status === "CANCELLED" || action.status === "REJECTED") {
          const error = action?.errorMessage || apiCopy("apiCopy.operation.failed.4e1af7c7");
          return NextResponse.json({ accepted: true, completed: false, success: false, error, action }, { status: action ? 422 : 404 });
        }
        return NextResponse.json({
          accepted: true,
          completed: action.status === "COMPLETED",
          executedInline: decisionResult ? decisionResult.executedInline : action.status === "EXECUTING",
          requiresApproval: decisionResult ? decisionResult.requiresApproval : action.status === "APPROVED",
          commandRequestId: decisionResult?.commandRequestId ?? action.commandRequestId ?? null,
          success: true,
          action,
        });
      }

      const result = await rejectHostedAction(
        id,
        session,
        body.reason,
      );
      await auditUserAction(
        session.userId,
        "ai.hosted-action.update",
        { actionId: id, decision: "reject", reason: body.reason ?? null },
        undefined,
        session.currentTeamId,
      );
      return NextResponse.json({ success: true, action: result });
    },
  );
}
