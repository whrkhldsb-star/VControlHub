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

export function finishChatGeneration(conversationId: string, userMessageId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM ai_conversations WHERE id = ${conversationId} FOR UPDATE`;
    const released = await tx.aiMessage.updateMany({
      where: { id: userMessageId, conversationId, role: "user", toolCallId: ACTIVE_GENERATION },
      data: { toolCallId: null },
    });
    if (released.count) {
      await tx.$executeRaw`UPDATE ai_conversations SET "updatedAt" = GREATEST(clock_timestamp(), "updatedAt" + interval '1 millisecond') WHERE id = ${conversationId}`;
    }
  });
}
