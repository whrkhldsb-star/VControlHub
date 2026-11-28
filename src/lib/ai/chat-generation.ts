import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

// The active user message is the durable generation token. Clearing history deletes it.
// A process crash leaves a bounded reservation. Each generation attempt receives its own
// timestamped unique lease (`ai:generating:<epochMs>:<uuid>`) so delayed continuations
// cannot age out under the original user message's createdAt or release each other's claim.
export const ACTIVE_GENERATION = "ai:generating";
export const ACTIVE_GENERATION_PREFIX = "ai:generating:";
export const GENERATION_EXPIRY_MS = 90 * 60_000;

export function makeGenerationLease(now = Date.now()): string {
  return `${ACTIVE_GENERATION_PREFIX}${now}:${randomUUID()}`;
}

export function isActiveGenerationMarker(value: string | null | undefined): boolean {
  return value === ACTIVE_GENERATION || Boolean(value?.startsWith(ACTIVE_GENERATION_PREFIX));
}

export function parseGenerationStartedAt(marker: string | null | undefined, fallbackCreatedAt: Date): number {
  if (marker && marker.startsWith(ACTIVE_GENERATION_PREFIX)) {
    const rest = marker.slice(ACTIVE_GENERATION_PREFIX.length);
    const sep = rest.indexOf(":");
    const rawTs = sep >= 0 ? rest.slice(0, sep) : rest;
    const parsed = Number(rawTs);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallbackCreatedAt.getTime();
}

export async function assertChatGeneration(
  tx: Prisma.TransactionClient,
  conversationId: string,
  userMessageId: string,
  leaseToken?: string,
) {
  const active = await tx.aiMessage.findFirst({
    where: {
      id: userMessageId,
      conversationId,
      role: "user",
      toolCallId: leaseToken ? leaseToken : { startsWith: ACTIVE_GENERATION },
    },
    select: { id: true },
  });
  if (!active) throw new ConflictError(t("backend.ai.conversationNotFound"));
}

export async function withChatGeneration<T>(
  conversationId: string,
  userMessageId: string,
  write: (tx: Prisma.TransactionClient) => Promise<T>,
  leaseToken?: string,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM ai_conversations WHERE id = ${conversationId} FOR SHARE`;
    await assertChatGeneration(tx, conversationId, userMessageId, leaseToken);
    return write(tx);
  });
}

export function finishChatGeneration(
  conversationId: string,
  userMessageId: string,
  firstQuestion?: string,
  leaseToken?: string,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM ai_conversations WHERE id = ${conversationId} FOR UPDATE`;
    const released = await tx.aiMessage.updateMany({
      where: {
        id: userMessageId,
        conversationId,
        role: "user",
        toolCallId: leaseToken ? leaseToken : { startsWith: ACTIVE_GENERATION },
      },
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
        "updatedAt" = GREATEST((clock_timestamp() AT TIME ZONE 'UTC'), c."updatedAt" + interval '1 millisecond')
        WHERE c.id = ${conversationId}`;
    }
  });
}
