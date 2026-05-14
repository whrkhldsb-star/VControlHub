import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/require-api-session";
import {
 getConversationById,
 updateConversation,
 deleteConversation,
 clearConversationMessages,
 serializeConversation,
} from "@/lib/ai/service";

export const dynamic = "force-dynamic";

const updateConversationSchema = z.object({
 title: z.string().min(1).max(200).optional(),
 systemPrompt: z.string().max(2000).optional(),
 model: z.string().optional(),
 temperature: z.number().min(0).max(2).optional(),
 maxTokens: z.number().int().min(1).max(128000).optional(),
 topP: z.number().min(0).max(1).optional(),
 frequencyPenalty: z.number().min(-2).max(2).optional(),
 presencePenalty: z.number().min(-2).max(2).optional(),
 enableVision: z.boolean().optional(),
 hostingEnabled: z.boolean().optional(),
});

export async function GET(
 _request: Request,
 { params }: { params: Promise<{ id: string }> }
) {
 try {
 const authed = await requireApiSession();
	if (authed instanceof NextResponse) return authed;
	const { session } = authed;
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
 const authed = await requireApiSession();
	if (authed instanceof NextResponse) return authed;
	const { session } = authed;
    const { id } = await params;
	const body = await request.json();
	const parsed = updateConversationSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: "输入参数无效" }, { status: 400 });
	}

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
 const authed = await requireApiSession();
	if (authed instanceof NextResponse) return authed;
	const { session } = authed;
    const { id } = await params;
    await deleteConversation(id, session.userId);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "删除失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
