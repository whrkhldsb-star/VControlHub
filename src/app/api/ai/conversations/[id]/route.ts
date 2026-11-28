import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";

import {
  clearConversationMessages,
  deleteConversation,
  getConversationById,
  serializeConversation,
  updateConversation,
} from "@/lib/ai/service";
import { updateConversationSchema } from "@/lib/ai/schema";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { z } from "zod";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { NotFoundError } from "@/lib/errors";
import { auditUserAction } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    { permission: "ai:chat", rateLimit: GENERAL_READ_LIMIT, errorMessage: apiCopy("apiCopy.not.found.e3ebaa16"), errorStatus: 404 },
    async ({ session }) => {
      const { id } = await params;
      const { before, beforeId } = parseSearchParams(request, z.object({
        before: z.iso.datetime().optional(), beforeId: z.string().min(1).max(128).optional(),
      }));
      const conv = before && beforeId
        ? await getConversationById(id, session, { createdAt: new Date(before), id: beforeId })
        : await getConversationById(id, session);
      return NextResponse.json({ conversation: serializeConversation(conv), hasMore: conv.messages.length === 500 });
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
      permission: "ai:chat",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: apiCopy("apiCopy.failed.to.update.8eb4917b"),
      errorStatus: 400,
      bodySchema: updateConversationSchema,
    },
    async ({ session, body }) => {
      const { id } = await params;

      // Special action: clear all messages in the conversation
      if (body.clearMessages) {
        await clearConversationMessages(id, session);
        const conv = await getConversationById(id, session);
        return NextResponse.json({ conversation: serializeConversation(conv) });
      }

      const conv = await updateConversation(id, session, body);
      if (!conv) throw new NotFoundError(apiCopy("apiCopy.conversation.not.found.d8e4dcef"));
      if (body.automationMode !== undefined || body.pinnedServerIds !== undefined) {
        await auditUserAction(
          session.userId,
          "ai.conversation.mode_change",
          {
            conversationId: id,
            automationMode: conv.automationMode,
            hostingEnabled: conv.hostingEnabled,
            automationModeExpiresAt: conv.automationModeExpiresAt?.toISOString() ?? null,
            pinnedServerCount: conv.pinnedServerIds?.length ?? 0,
          },
          undefined,
          session.currentTeamId,
        );
      } else {
        await auditUserAction(session.userId, "conversation.update", { conversationId: id }, undefined, session.currentTeamId);
      }
      return NextResponse.json({
        conversation: {
          ...conv,
          automationModeExpiresAt: conv.automationModeExpiresAt?.toISOString() ?? null,
          pinnedServerIds: conv.pinnedServerIds ?? [],
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
      permission: "ai:chat",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: apiCopy("apiCopy.failed.to.delete.f625b14e"),
      errorStatus: 400,
    },
    async ({ session }) => {
      const { id } = await params;
      await deleteConversation(id, session);
      await auditUserAction(session.userId, "conversation.delete", { conversationId: id }, undefined, session.currentTeamId);
      return NextResponse.json({ ok: true });
    },
  );
}
