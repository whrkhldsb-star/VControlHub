import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logging";

const logger = createLogger("api:settings");

import { z } from "zod";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import {
	getAllSettingsMasked,
	setManySettings,
	isValidSettingKey,
} from "@/lib/settings/service";
import { SettingKey, MASKED_VALUE } from "@/lib/settings/schema";

export const dynamic = "force-dynamic";

/* ── Zod schema for PATCH body ────────────────────────────── */

const patchEntrySchema = z.object({
	key: SettingKey,
	value: z.string().min(1, "值不能为空"),
});

const patchBodySchema = z.record(z.string(), z.string());

/* ── GET ──────────────────────────────────────────────────── */

export async function GET() {
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "user:manage")) {
			return NextResponse.json({ error: "权限不足" }, { status: 403 });
		}
		// getAllSettingsMasked already masks sensitive values (***)
		const settings = await getAllSettingsMasked();
		return NextResponse.json({ settings });
	} catch (error) {
		logger.error("获取系统设置失败", error);
		return NextResponse.json({ error: "服务器错误" }, { status: 500 });
	}
}

/* ── PATCH ────────────────────────────────────────────────── */

export async function PATCH(request: Request) {
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "user:manage")) {
			return NextResponse.json({ error: "权限不足" }, { status: 403 });
		}

		const body = await request.json();

		// 1. Validate the body is a string→string record
		const parsed = patchBodySchema.safeParse(body);
		if (!parsed.success) {
			return NextResponse.json(
				{ error: "请求格式错误", details: parsed.error.flatten() },
				{ status: 400 }
			);
		}

		// 2. Filter entries: reject keys not in whitelist, skip sentinel values
		const entries: Array<{ key: string; value: string }> = [];
		const rejectedKeys: string[] = [];

		for (const [key, value] of Object.entries(parsed.data)) {
			if (!isValidSettingKey(key)) {
				rejectedKeys.push(key);
				continue;
			}
			// Skip if the client sent the masked sentinel back unchanged
			if (value === MASKED_VALUE) {
				continue;
			}
			// Per-entry Zod validation (key enum + value non-empty string)
			const entryResult = patchEntrySchema.safeParse({ key, value });
			if (!entryResult.success) {
				rejectedKeys.push(key);
				continue;
			}
			entries.push({ key, value });
		}

		if (rejectedKeys.length > 0) {
			return NextResponse.json(
				{
					error: `不允许的配置项: ${rejectedKeys.join(", ")}`,
					rejectedKeys,
				},
				{ status: 400 }
			);
		}

		if (entries.length === 0) {
			return NextResponse.json({
				success: true,
				message: "无有效更新项",
			});
		}

		await setManySettings(entries);
		return NextResponse.json({ success: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : "保存失败";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}
