import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/require-api-permission";
import {
  createConversation,
  listConversations,
  serializeConversationListItem,
} from "@/lib/ai/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const authed = await requireApiPermission("ai:manage");
	if (authed instanceof NextResponse) return authed;
	const { session } = authed;
    const conversations = await listConversations(session.userId);
    return NextResponse.json({
      conversations: conversations.map(serializeConversationListItem),
    });
  } catch {
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const authed = await requireApiPermission("ai:manage");
	if (authed instanceof NextResponse) return authed;
	const { session } = authed;
    const body = await request.json();
    const conv = await createConversation({ ...body, createdBy: session.userId });
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
      { status: 201 }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "创建失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
