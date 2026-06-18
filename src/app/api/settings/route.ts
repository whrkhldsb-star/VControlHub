import { NextResponse } from "next/server";
import { z } from "zod";
import {
	getAllSettingsMasked,
	setManySettings,
	isValidSettingKey,
} from "@/lib/settings/service";
import { SettingKey, MASKED_VALUE } from "@/lib/settings/schema";
import { isRuntimeSettingKey, normalizeRuntimeSettingValue } from "@/lib/runtime-settings/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { auditUserAction } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

/* ── Zod schema for PATCH body ────────────────────────────── */

const patchEntrySchema = z.object({
	key: SettingKey,
	value: z.string(),
});

const patchBodySchema = z.record(z.string(), z.string());

function normalizeIntegerSetting(
	key: string,
	value: string,
	label: string,
	min: number,
	max: number,
) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		throw new Error(`${label} 必须是数字`);
	}
	const integer = Math.trunc(parsed);
	if (integer < min || integer > max) {
		throw new Error(`${label} 必须在 ${min} 到 ${max} 之间`);
	}
	return { key, value: String(integer) };
}

function normalizeBooleanSetting(key: string, value: string) {
	if (value !== "true" && value !== "false") {
		throw new Error(`${key} 必须是 true 或 false`);
	}
	return { key, value };
}

function normalizeOptionalHttpUrl(key: string, value: string) {
	const trimmed = value.trim();
	if (!trimmed) return { key, value: "" };
	if (trimmed.startsWith("/")) return { key, value: trimmed };
	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw new Error("Logo URL 只支持 http(s) 或站内路径");
		}
	} catch {
		throw new Error("Logo URL 只支持 http(s) 或站内路径");
	}
	return { key, value: trimmed };
}

function normalizeSettingValue(key: string, value: string) {
	if (isRuntimeSettingKey(key)) {
		return { key, value: normalizeRuntimeSettingValue(key, value) };
	}
	switch (key) {
		case "platform.name": {
			const trimmed = value.trim();
			if (!trimmed) throw new Error("平台名称不能为空");
			if (trimmed.length > 80) throw new Error("平台名称不能超过 80 个字符");
			return { key, value: trimmed };
		}
		case "platform.logo":
			return normalizeOptionalHttpUrl(key, value);
		case "session.timeout":
			return normalizeIntegerSetting(key, value, "会话超时", 300, 2_592_000);
		case "password.minLength":
			return normalizeIntegerSetting(key, value, "密码最小长度", 8, 128);
		case "password.requireUppercase":
		case "password.requireNumber":
		case "password.requireSpecial":
		case "smtp.enabled":
			return normalizeBooleanSetting(key, value);
		case "smtp.port":
			return normalizeIntegerSetting(key, value || "587", "SMTP 端口", 1, 65_535);
		case "smtp.from": {
			const trimmed = value.trim();
			if (trimmed && !/^.+@.+\..+$/.test(trimmed)) {
				throw new Error("发件人地址格式不正确");
			}
			return { key, value: trimmed };
		}
		case "smtp.alertRecipients": {
			const recipients = value
				.split(/[\n,;，；]+/)
				.map((item) => item.trim())
				.filter(Boolean);
			const invalid = recipients.find((recipient) => !/^.+@.+\..+$/.test(recipient));
			if (invalid) {
				throw new Error(`告警收件人地址格式不正确：${invalid}`);
			}
			return { key, value: recipients.join(",") };
		}
		case "smtp.host":
		case "smtp.user":
		case "smtp.pass":
			return { key, value: value.trim() };
		case "telegram.enabled":
			return normalizeBooleanSetting(key, value);
		case "telegram.botToken":
			// Bot Token 形如 "123456:ABC-DEF..." — 拒绝空白和明显非 token 字符; 不强校验格式以兼容老 Bot API
			return { key, value: value.trim() };
		case "telegram.chatId": {
			// 允许多目标 (群/频道) 逗号/分号/换行/CJK 分隔; 每个目标必须是数字 (group 为负数) 或 "@channelusername"
			const tokens = value
				.split(/[\n,;，；]+/)
				.map((item) => item.trim())
				.filter(Boolean);
			if (tokens.length === 0) {
				throw new Error("Telegram Chat ID 至少配置 1 个目标");
			}
			const invalid = tokens.find((token) => !/^-?\d+$/.test(token) && !/^@[A-Za-z0-9_]{4,}$/.test(token));
			if (invalid) {
				throw new Error(`Telegram Chat ID 格式不正确：${invalid}（应为数字或 @channelusername）`);
			}
			return { key, value: tokens.join(",") };
		}
		default:
			return { key, value };
	}
}

/* ── GET ──────────────────────────────────────────────────── */

export async function GET(request: Request) {
	return withApiRoute(request, { permission: "user:manage", errorStatus: 500, errorMessage: "服务器错误" }, async () => {
		// getAllSettingsMasked already masks sensitive values (***)
		const settings = await getAllSettingsMasked();
		return NextResponse.json({ settings });
	});
}

/* ── PATCH ────────────────────────────────────────────────── */

export async function PATCH(request: Request) {
	return withApiRoute(request, { permission: "user:manage", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 400, errorMessage: "保存失败" }, async ({ session }) => {
		const body = await request.json();

		// 1. Validate the body is a string→string record
		const parsed = patchBodySchema.safeParse(body);
		if (!parsed.success) {
			return NextResponse.json(
				{ error: "请求格式错误", details: parsed.error.flatten() },
				{ status: 400 }
			);
		}

		// 2. Filter entries: reject keys not in whitelist, skip sentinel values, normalize supported value types.
		const entries: Array<{ key: string; value: string }> = [];
		const rejectedKeys: string[] = [];
		const validationErrors: string[] = [];

		for (const [key, value] of Object.entries(parsed.data)) {
			if (!isValidSettingKey(key)) {
				rejectedKeys.push(key);
				continue;
			}
			// Skip if the client sent the masked sentinel back unchanged
			if (value === MASKED_VALUE) {
				continue;
			}
			// Per-entry Zod validation (key enum + string value)
			const entryResult = patchEntrySchema.safeParse({ key, value });
			if (!entryResult.success) {
				rejectedKeys.push(key);
				continue;
			}
			try {
				entries.push(normalizeSettingValue(key, value));
			} catch (error) {
				validationErrors.push(error instanceof Error ? error.message : `${key} 校验失败`);
			}
		}

		if (rejectedKeys.length > 0 || validationErrors.length > 0) {
			return NextResponse.json(
				{
					error: [
						rejectedKeys.length > 0 ? `不允许的配置项: ${rejectedKeys.join(", ")}` : null,
						...validationErrors,
					].filter(Boolean).join("；"),
					rejectedKeys,
					details: validationErrors,
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
		auditUserAction(session?.userId ?? "", "settings.update", {
			keys: entries.map((entry) => entry.key),
			count: entries.length,
		});
		return NextResponse.json({ success: true });
	});
}
