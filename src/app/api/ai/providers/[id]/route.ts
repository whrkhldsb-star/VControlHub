import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/require-api-session";
import { requireApiPermission } from "@/lib/auth/require-api-permission";
import {
	getProviderById,
	updateProvider,
	deleteProvider,
} from "@/lib/ai/service";
import { withRateLimit, rateLimitResponse, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

const updateProviderSchema = z.object({
	name: z.string().min(1).optional(),
	apiKey: z.string().min(1).optional(),
	baseUrl: z.string().url().optional(),
	models: z.string().optional(),
	availableModels: z.array(z.string()).optional(),
	defaultModel: z.string().optional(),
	isDefault: z.boolean().optional(),
	enabled: z.boolean().optional(),
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
		const provider = await getProviderById(id, session.userId);
		// Mask API key
		return NextResponse.json({
			provider: {
				...provider,
				apiKey: provider.apiKey.slice(0, 8) + "..." + provider.apiKey.slice(-4),
				createdAt: provider.createdAt.toISOString(),
				updatedAt: provider.updatedAt.toISOString(),
			},
		});
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : "未找到";
		return NextResponse.json({ error: msg }, { status: 404 });
	}
}

export async function PATCH(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
	if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
	try {
		const authed = await requireApiPermission("ai:manage");
		if (authed instanceof NextResponse) return authed;
		const { session } = authed;
		const { id } = await params;
		const body = await request.json();
		const parsed = updateProviderSchema.safeParse(body);
		if (!parsed.success) {
			return NextResponse.json({ error: "输入参数无效" }, { status: 400 });
		}
		const updateBody = {
			...parsed.data,
			...(parsed.data.availableModels !== undefined
				? { availableModels: parsed.data.availableModels }
				: parsed.data.models !== undefined
					? { availableModels: parsed.data.models.split(",").map((m) => m.trim()).filter(Boolean) }
					: {}),
		};
		const provider = await updateProvider(id, session.userId, updateBody);
		return NextResponse.json({
			provider: {
				...provider,
				apiKey: provider.apiKey.slice(0, 8) + "..." + provider.apiKey.slice(-4),
				createdAt: provider.createdAt.toISOString(),
				updatedAt: provider.updatedAt.toISOString(),
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
	const rl = withRateLimit(_request, GENERAL_WRITE_LIMIT);
	if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
	try {
		const authed = await requireApiPermission("ai:manage");
		if (authed instanceof NextResponse) return authed;
		const { session } = authed;
		const { id } = await params;
		await deleteProvider(id, session.userId);
		return NextResponse.json({ ok: true });
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : "删除失败";
		return NextResponse.json({ error: msg }, { status: 400 });
	}
}
