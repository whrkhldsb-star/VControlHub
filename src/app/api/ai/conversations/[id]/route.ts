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
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { NotFoundError } from "@/lib/errors";
import { auditUserAction } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    { permission: "ai:chat", errorMessage: apiCopy("apiCopy.not.found.e3ebaa16"), errorStatus: 404 },
    async ({ session }) => {
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
        await clearConversationMessages(id, session.userId);
        const conv = await getConversationById(id, session.userId);
        return NextResponse.json({ conversation: serializeConversation(conv) });
      }

      const conv = await updateConversation(id, session.userId, body);
      if (!conv) throw new NotFoundError(apiCopy("apiCopy.conversation.not.found.d8e4dcef"));
      await auditUserAction(session.userId, "conversation.update", { conversationId: id }, undefined, session.currentTeamId);
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
      permission: "ai:chat",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: apiCopy("apiCopy.failed.to.delete.f625b14e"),
      errorStatus: 400,
    },
    async ({ session }) => {
      const { id } = await params;
      await deleteConversation(id, session.userId);
      await auditUserAction(session.userId, "conversation.delete", { conversationId: id }, undefined, session.currentTeamId);
      return NextResponse.json({ ok: true });
    },
  );
}
