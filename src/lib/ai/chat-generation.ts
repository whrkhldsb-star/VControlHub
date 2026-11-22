import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

// The active user message is the durable generation token. Clearing history deletes it.
// A process crash leaves a bounded reservation. A replacement invalidates it under the parent lock.
export const ACTIVE_GENERATION = "ai:generating";
export const GENERATION_EXPIRY_MS = 90 * 60_000;

export async function assertChatGeneration(tx: Prisma.TransactionClient, conversationId: string, userMessageId: string) {
  const active = await tx.aiMessage.findFirst({
    where: { id: userMessageId, conversationId, role: "user", toolCallId: ACTIVE_GENERATION }, select: { id: true },
  });
  if (!active) throw new ConflictError(t("backend.ai.conversationNotFound"));
}

export async function withChatGeneration<T>(
  conversationId: string, userMessageId: string, write: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM ai_conversations WHERE id = ${conversationId} FOR SHARE`;
    await assertChatGeneration(tx, conversationId, userMessageId);
    return write(tx);
  });
}

export function finishChatGeneration(conversationId: string, userMessageId: string, firstQuestion?: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM ai_conversations WHERE id = ${conversationId} FOR UPDATE`;
    const released = await tx.aiMessage.updateMany({
      where: { id: userMessageId, conversationId, role: "user", toolCallId: ACTIVE_GENERATION },
      data: { toolCallId: null },
    });
    if (released.count) {
      const chars = Array.from((firstQuestion ?? "").trim().replace(/\n/g, " "));
      const title = chars.length && firstQuestion !== "(attachment)" && firstQuestion !== "(附件)"
        ? chars.slice(0, 30).join("") + (chars.length > 30 ? "..." : "") : null;
      await tx.$executeRaw`UPDATE ai_conversations c SET
        title = CASE WHEN ${title}::text IS NOT NULL AND c.title IN ('New conversation', '新对话') AND NOT EXISTS (
          SELECT 1 FROM ai_messages m WHERE m."conversationId" = c.id AND m.role = 'user' AND m.id <> ${userMessageId}
        ) THEN ${title} ELSE c.title END,
        "updatedAt" = GREATEST(clock_timestamp(), c."updatedAt" + interval '1 millisecond')
        WHERE c.id = ${conversationId}`;
    }
  });
}
