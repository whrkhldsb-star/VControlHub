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
    { permission: "ai:chat", errorMessage: "Not found", errorStatus: 404 },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: "Not authenticated or session expired" },
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
      permission: "ai:chat",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "Failed to update",
      errorStatus: 400,
      bodySchema: updateConversationSchema,
    },
    async ({ session, body }) => {
      if (!session)
        return NextResponse.json(
          { error: "Not authenticated or session expired" },
          { status: 401 },
        );
      const { id } = await params;

      // Special action: clear all messages in the conversation
      if (body.clearMessages) {
        await clearConversationMessages(id, session.userId);
        const conv = await getConversationById(id, session.userId);
        return NextResponse.json({ conversation: serializeConversation(conv) });
      }

      const conv = await updateConversation(id, session.userId, body);
      if (!conv) throw new NotFoundError("Conversation not found");
      await auditUserAction(session?.userId ?? "", "conversation.update", { conversationId: id });
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
      errorMessage: "Failed to delete",
      errorStatus: 400,
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: "Not authenticated or session expired" },
          { status: 401 },
        );
      const { id } = await params;
      await deleteConversation(id, session.userId);
      await auditUserAction(session?.userId ?? "", "conversation.delete", { conversationId: id });
      return NextResponse.json({ ok: true });
    },
  );
}
