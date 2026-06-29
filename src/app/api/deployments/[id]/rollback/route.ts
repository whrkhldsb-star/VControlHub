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
  reason: z.string().trim().max(500, "原因最多 500 个字符").optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(
    request,
    {
      permission: "deploy:run",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "回滚失败",
      bodySchema: rollbackSchema,
    },
    async ({ session, body }) => {
      if (!session) throw new AuthError("未登录或会话已过期");
      const { id } = await params;
      try {
        const rollback = await createDeploymentRollbackRun({
          sourceRunId: id,
          requesterId: session.userId,
          reason: body.reason,
        });
        auditUserAction(session.userId, "deployment.rollback", {
          sourceRunId: id,
          rollbackId: rollback.id,
          commandRequestId: rollback.commandRequestId,
          reason: body.reason ?? null,
        });
        return NextResponse.json({ rollback }, { status: 201 });
      } catch (error) {
        const message = error instanceof Error ? error.message : "回滚失败";
        if (message.includes("不存在")) return apiError({ status: 404, code: "NOT_FOUND", message });
        if (message.includes("快照") || message.includes("回滚命令")) {
          return apiError({ status: 400, code: "BUSINESS_RULE_FAILED", message });
        }
        return apiError({ status: 500, code: "INTERNAL_ERROR", message });
      }
    },
  );
}
