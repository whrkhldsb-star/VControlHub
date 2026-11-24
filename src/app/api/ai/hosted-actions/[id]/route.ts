import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * PATCH /api/ai/hosted-actions/[id] — approve or reject an AI hosted action
 *
 * Permission rules:
 * - `confirm` requires the action-specific permission in the service layer.
 * - `approve` / `reject` require `ai:action:approve` in the service layer.
 */

import { NextResponse } from "next/server";

import {
  approveHostedAction,
  confirmHostedAction,
  rejectHostedAction,
} from "@/lib/ai/hosted-service";
import { hostedActionDecisionSchema } from "@/lib/ai/schema";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

import { auditUserAction } from "@/lib/audit/service";
export const dynamic = "force-dynamic";

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
        const decide = body.action === "confirm" ? confirmHostedAction : approveHostedAction;
        await decide(id, session);
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
        return NextResponse.json({ accepted: true, completed: action.status === "COMPLETED", success: true, action });
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
