import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";

import {
  createConversation,
  listConversations,
  serializeConversationListItem,
} from "@/lib/ai/service";
import { createConversationSchema } from "@/lib/ai/schema";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "ai:chat", errorMessage: apiCopy("apiCopy.server.error.dfe0c2e8") },
    async ({ session }) => {
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
      errorMessage: apiCopy("apiCopy.failed.to.create.99af0e81"),
      bodySchema: createConversationSchema,
    },
    async ({ session, body }) => {
      const conv = await createConversation({
        ...body,
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
