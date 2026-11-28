import { NextResponse } from "next/server";
import { createAiContinueResponse } from "@/lib/ai/chat-orchestrator";
import { enforceApiGuard, withApiRoute } from "@/lib/http/api-guard";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { checkRateLimitAsync, getClientIp, rateLimitIpKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const AI_CHAT_LIMIT = { maxRequests: 20, windowMs: 60_000 };
const AI_CHAT_IP_LIMIT = { maxRequests: 120, windowMs: 60_000 };

/**
 * POST /api/ai/conversations/[id]/continue — resume the AI assistant loop after
 * one or more inline hosted actions have settled, without creating a fake user
 * message. Shares the `ai-chat-user:` rate limit bucket with `/api/ai/chat`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const locale = await getServerLocale();
  const rateLimit = await checkRateLimitAsync(`ai-chat:${rateLimitIpKey(getClientIp(request))}`, AI_CHAT_IP_LIMIT);
  if (!rateLimit.allowed) {
    const message = t("apiAiChat.rateLimited", locale);
    return NextResponse.json(
      { code: "RATE_LIMITED", message, error: message },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)) } },
    );
  }

  return withApiRoute(
    request,
    {
      permission: "ai:chat",
      errorMessage: t("apiAiChat.errorMessage", locale),
    },
    async ({ session }) => {
      const userLimit = await checkRateLimitAsync(`ai-chat-user:${session.userId}`, AI_CHAT_LIMIT);
      if (!userLimit.allowed) {
        const message = t("apiAiChat.rateLimited", locale);
        return NextResponse.json(
          { code: "RATE_LIMITED", message, error: message },
          { status: 429, headers: { "Retry-After": String(Math.ceil(userLimit.retryAfterMs / 1000)) } },
        );
      }
      const { id } = await params;
      return createAiContinueResponse({
        conversationId: id,
        session,
        reloadSession: async () => {
          const live = await enforceApiGuard({
            request,
            permission: "ai:chat",
          });
          return live instanceof Response ? null : live;
        },
        locale,
        signal: request.signal,
      });
    },
  );
}
