import { NextResponse } from "next/server";

import { createAiChatResponse } from "@/lib/ai/chat-orchestrator";
import { chatRequestSchema } from "@/lib/ai/schema";
import { ValidationError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const AI_CHAT_LIMIT = { maxRequests: 20, windowMs: 60_000 };

export async function POST(request: Request) {
  const locale = await getServerLocale();
  const rateLimit = await checkRateLimitAsync(getClientIp(request), AI_CHAT_LIMIT);
  if (!rateLimit.allowed) {
    const message = t("apiAiChat.rateLimited", locale);
    return NextResponse.json(
      { code: "RATE_LIMITED", message, error: message },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)) },
      },
    );
  }

  return withApiRoute(
    request,
    {
      permission: "ai:chat",
      errorMessage: t("apiAiChat.errorMessage", locale),
      bodySchema: chatRequestSchema,
    },
    async ({ session, body }) => {
      if (!session) {
        return NextResponse.json(
          { error: t("apiAiChat.unauthorized", locale) },
          { status: 401 },
        );
      }

      const content = (body.content ?? body.message ?? "").trim();
      if (!body.conversationId || !content) {
        throw new ValidationError(t("apiAiChat.missingParams", locale));
      }
      return createAiChatResponse({
        body: { ...body, conversationId: body.conversationId, content },
        session,
        locale,
      });
    },
  );
}
