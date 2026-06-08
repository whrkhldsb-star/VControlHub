/**
 * PATCH /api/ai/hosted-actions/[id] — approve or reject an AI hosted action
 *
 * Permission rules:
 * - Users need `ai:action:approve` to approve or reject hosted actions.
 */

import { NextResponse } from "next/server";

import {
  approveHostedAction,
  rejectHostedAction,
} from "@/lib/ai/hosted-service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      requireAuth: true,
      permission: "ai:action:approve",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorStatus: 400,
      errorMessage: "操作失败",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });
      const { id } = await params;

      let body: { action: "approve" | "reject"; reason?: string };
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ error: "无效请求" }, { status: 400 });
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
