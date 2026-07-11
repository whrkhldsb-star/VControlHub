import { NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { createDeploymentRollbackRun } from "@/lib/deployment/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { apiError } from "@/lib/http/api-error";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

import { AuthError } from "@/lib/errors";
export const dynamic = "force-dynamic";

const rollbackSchema = z.object({
  reason: z.string().trim().max(500, "ReasonAt most 500 characters").optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(
    request,
    {
      permission: "deploy:run",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "Rollback failed",
      bodySchema: rollbackSchema,
    },
    async ({ session, body }) => {
      if (!session) throw new AuthError("Not authenticated or session expired");
      const { id } = await params;
      try {
        const rollback = await createDeploymentRollbackRun({
          sourceRunId: id,
          requesterId: session.userId,
          reason: body.reason,
        });
        await auditUserAction(session.userId, "deployment.rollback", {
          sourceRunId: id,
          rollbackId: rollback.id,
          commandRequestId: rollback.commandRequestId,
          reason: body.reason ?? null,
        });
        return NextResponse.json({ rollback }, { status: 201 });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Rollback failed";
        if (message.includes("not found")) return apiError({ status: 404, code: "NOT_FOUND", message });
        if (message.includes("already has rollback task")) return apiError({ status: 409, code: "CONFLICT", message });
        if (message.includes("snapshot") || message.includes("rollback command")) {
          return apiError({ status: 400, code: "BUSINESS_RULE_FAILED", message });
        }
        return apiError({ status: 500, code: "INTERNAL_ERROR", message });
      }
    },
  );
}
