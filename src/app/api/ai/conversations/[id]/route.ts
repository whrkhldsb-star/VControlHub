import { NextResponse } from "next/server";
import { z } from "zod";

import {
  clearConversationMessages,
  deleteConversation,
  getConversationById,
  serializeConversation,
  updateConversation,
} from "@/lib/ai/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

const updateConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  systemPrompt: z.string().max(2000).optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(128000).optional(),
  topP: z.number().min(0).max(1).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  enableVision: z.boolean().optional(),
  hostingEnabled: z.boolean().optional(),
  clearMessages: z.boolean().optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    { requireAuth: true, errorMessage: "未找到", errorStatus: 404 },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: "未登录或会话已过期" },
          { status: 401 },
        );
      const { id } = await params;
      const conv = await getConversationById(id, session.userId);
      return NextResponse.json({ conversation: serializeConversation(conv) });
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
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "更新失败",
      errorStatus: 400,
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: "未登录或会话已过期" },
          { status: 401 },
        );
      const { id } = await params;
      const body = await request.json().catch(() => null);
      const parsed = updateConversationSchema.safeParse(body);
      if (!parsed.success)
        return NextResponse.json({ error: "输入参数无效" }, { status: 400 });

      // Special action: clear all messages in the conversation
      if (parsed.data.clearMessages) {
        await clearConversationMessages(id, session.userId);
        const conv = await getConversationById(id, session.userId);
        return NextResponse.json({ conversation: serializeConversation(conv) });
      }

      const conv = await updateConversation(id, session.userId, parsed.data);
      return NextResponse.json({
        conversation: {
          ...conv,
          createdAt: conv.createdAt.toISOString(),
          updatedAt: conv.updatedAt.toISOString(),
        },
      });
    },
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "删除失败",
      errorStatus: 400,
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: "未登录或会话已过期" },
          { status: 401 },
        );
      const { id } = await params;
      await deleteConversation(id, session.userId);
      return NextResponse.json({ ok: true });
    },
  );
}
