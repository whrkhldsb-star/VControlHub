/**
 * PATCH /api/ai/hosted-actions/[id] — approve or reject an AI hosted action
 *
 * Permission rules:
 * - `confirm` requires an authenticated requester with `server:ssh` in the service layer.
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

import { AuthError } from "@/lib/errors";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      errorStatus: 400,
      errorMessage: "OperationFailed",
      bodySchema: hostedActionDecisionSchema,
    },
    async ({ session, body }) => {
      if (!session)
        throw new AuthError("Not authenticated");
      const { id } = await params;

      if (body.action === "confirm") {
        await confirmHostedAction(id, session);
        const { prisma } = await import("@/lib/db");
        const action = await prisma.aiHostedAction.findUnique({
          where: { id },
        });
        return NextResponse.json({ success: true, action });
      }

      if (body.action === "approve") {
        await approveHostedAction(id, session);
        const { prisma } = await import("@/lib/db");
        const action = await prisma.aiHostedAction.findUnique({
          where: { id },
        });
        return NextResponse.json({ success: true, action });
      }

      const result = await rejectHostedAction(
        id,
        session,
        body.reason,
      );
      return NextResponse.json({ success: true, action: result });
    },
  );
}
