import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import {
 getConversationById,
 updateConversation,
 deleteConversation,
 clearConversationMessages,
 serializeConversation,
} from "@/lib/ai/service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    if (!sessionHasPermission(session, "ai:manage"))
      return NextResponse.json({ error: "缺少权限" }, { status: 403 });
    const { id } = await params;
    const conv = await getConversationById(id, session.userId);
    return NextResponse.json({ conversation: serializeConversation(conv) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "未找到";
    return NextResponse.json({ error: msg }, { status: 404 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    if (!sessionHasPermission(session, "ai:manage"))
      return NextResponse.json({ error: "缺少权限" }, { status: 403 });
    const { id } = await params;
    const body = await request.json();

    // Special action: clear all messages in the conversation
    if (body.clearMessages) {
      await clearConversationMessages(id, session.userId);
      const conv = await getConversationById(id, session.userId);
      return NextResponse.json({
        conversation: serializeConversation(conv),
      });
    }

    const conv = await updateConversation(id, session.userId, body);
    return NextResponse.json({
      conversation: {
        ...conv,
        createdAt: conv.createdAt.toISOString(),
        updatedAt: conv.updatedAt.toISOString(),
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "更新失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    if (!sessionHasPermission(session, "ai:manage"))
      return NextResponse.json({ error: "缺少权限" }, { status: 403 });
    const { id } = await params;
    await deleteConversation(id, session.userId);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "删除失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
