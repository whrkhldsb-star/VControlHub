import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { canReadCommandBody } from "@/lib/command/visibility";
import { createDeploymentRollbackRun } from "@/lib/deployment/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { apiCatch } from "@/lib/http/api-error";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

const rollbackSchema = z.object({
  reason: z.string().trim().max(500, "Reason must be at most 500 characters").optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(
    request,
    {
      permission: "deploy:run",
      optionalTokenPermissions: ["command:read", "command:approve"],
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: apiCopy("apiCopy.rollback.failed.69b0b69b"),
      bodySchema: rollbackSchema,
    },
    async ({ session, body }) => {
      const { id } = await params;
      try {
        const rollback = await createDeploymentRollbackRun({
          sourceRunId: id,
          requesterId: session.userId,
          reason: body.reason,
        }, session);
        await auditUserAction(session.userId, "deployment.rollback", {
          sourceRunId: id,
          rollbackId: rollback.id,
          commandRequestId: rollback.commandRequestId,
          reason: body.reason ?? null,
        }, undefined, session.currentTeamId);
        const canRead = sessionHasPermission(session, "command:read")
          && canReadCommandBody(session.userId, rollback.snapshot?.createdBy ?? null, sessionHasPermission(session, "command:approve"));
        const projected = !canRead && ("rollbackCommand" in rollback || "snapshot" in rollback)
          ? {
              ...rollback,
              ...("rollbackCommand" in rollback ? { rollbackCommand: "" } : {}),
              ...(rollback.snapshot ? { snapshot: { ...rollback.snapshot, deployCommand: "", rollbackCommand: null, variables: {} } } : {}),
            }
          : rollback;
        return NextResponse.json({ rollback: projected }, { status: 201 });
      } catch (error) {
        return apiCatch(error);
      }
    },
  );
}
