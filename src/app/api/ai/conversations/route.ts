import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/require-api-session";
import { createLogger } from "@/lib/logging";
import {
	createConversation,
	listConversations,
	serializeConversationListItem,
} from "@/lib/ai/service";
import { withRateLimit, rateLimitResponse, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

const logger = createLogger("api:ai:conversations");

export const dynamic = "force-dynamic";

const createConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});

export async function GET() {
	try {
		const authed = await requireApiSession();
		if (authed instanceof NextResponse) return authed;
		const { session } = authed;
		const conversations = await listConversations(session.userId);
		return NextResponse.json({
			conversations: conversations.map(serializeConversationListItem),
		});
	} catch (error) {
		logger.error("list conversations failed", error);
		return NextResponse.json({ error: "服务器错误" }, { status: 500 });
	}
}

export async function POST(request: Request) {
	const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
	if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
	try {
		const authed = await requireApiSession();
		if (authed instanceof NextResponse) return authed;
		const { session } = authed;
		// Check ai:chat permission
		const { sessionHasPermission } = await import("@/lib/auth/authorization");
		if (!sessionHasPermission(session, "ai:chat")) {
		 return NextResponse.json({ error: "你没有使用 AI 助手的权限" }, { status: 403 });
		}

		const body = await request.json();
		const parsed = createConversationSchema.safeParse(body);
		if (!parsed.success) {
			return NextResponse.json({ error: "输入参数无效" }, { status: 400 });
		}
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
			{ status: 201 },
		);
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : "创建失败";
		return NextResponse.json({ error: msg }, { status: 400 });
	}
}
