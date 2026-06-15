import { NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { createDeploymentRollbackRun } from "@/lib/deployment/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

import { AuthError, ValidationError } from "@/lib/errors";
export const dynamic = "force-dynamic";

const rollbackSchema = z.object({
  reason: z.string().trim().max(500, "原因最多 500 个字符").optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(
    request,
    { permission: "deploy:run", rateLimit: GENERAL_WRITE_LIMIT, errorMessage: "回滚失败" },
    async ({ session }) => {
      if (!session) throw new AuthError("未登录或会话已过期");
      const { id } = await params;
      const parsed = rollbackSchema.safeParse(await request.json().catch(() => ({})));
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "回滚参数无效");
      try {
        const rollback = await createDeploymentRollbackRun({
          sourceRunId: id,
          requesterId: session.userId,
          reason: parsed.data.reason,
        });
        auditUserAction(session.userId, "deployment.rollback", {
          sourceRunId: id,
          rollbackId: rollback.id,
          commandRequestId: rollback.commandRequestId,
          reason: parsed.data.reason ?? null,
        });
        return NextResponse.json({ rollback }, { status: 201 });
      } catch (error) {
        const message = error instanceof Error ? error.message : "回滚失败";
        const status = message.includes("不存在") ? 404 : message.includes("快照") || message.includes("回滚命令") ? 400 : 500;
        return NextResponse.json({ error: message }, { status });
      }
    },
  );
}
