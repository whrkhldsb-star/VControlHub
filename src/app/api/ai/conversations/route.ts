import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createConversation,
  listConversations,
  serializeConversationListItem,
} from "@/lib/ai/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

const createConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  providerId: z.string().min(1),
  model: z.string().min(1),
  systemPrompt: z.string().max(2000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(128000).optional(),
  topP: z.number().min(0).max(1).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  enableVision: z.boolean().optional(),
  hostingEnabled: z.boolean().optional(),
});

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { requireAuth: true, errorMessage: "服务器错误" },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: "未登录或会话已过期" },
          { status: 401 },
        );
      const conversations = await listConversations(session.userId);
      return NextResponse.json({
        conversations: conversations.map(serializeConversationListItem),
      });
    },
  );
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "ai:chat",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "创建失败",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: "未登录或会话已过期" },
          { status: 401 },
        );
      const body = await request.json().catch(() => null);
      const parsed = createConversationSchema.safeParse(body);
      if (!parsed.success)
        return NextResponse.json({ error: "输入参数无效" }, { status: 400 });

      const conv = await createConversation({
        ...parsed.data,
        createdBy: session.userId,
      });
      return NextResponse.json(
        {
          conversation: {
            ...conv,
            createdAt: conv.createdAt.toISOString(),
            updatedAt: conv.updatedAt.toISOString(),
            provider: conv.provider
              ? {
                  ...conv.provider,
                  createdAt: conv.provider.createdAt.toISOString(),
                  updatedAt: conv.provider.updatedAt.toISOString(),
                }
              : null,
          },
        },
        { status: 201 },
      );
    },
  );
}
