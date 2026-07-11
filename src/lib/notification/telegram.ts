import { ValidationError } from "@/lib/errors";
import { getAllSettings } from "@/lib/settings/service";

/* ── Types ────────────────────────────────────────────────── */

export type TelegramConfig = {
	enabled: boolean;
	botToken: string;
	chatIds: string[];
};

export type TelegramMessageInput = {
	title: string;
	message: string;
	contextLines?: string[];
};

export type TelegramDeliveryResult = {
	chatId: string;
	messageId?: number;
};

export type TelegramBatchDeliveryResult = {
	accepted: TelegramDeliveryResult[];
	rejected: { chatId: string; reason: string }[];
};

/* ── Helpers ──────────────────────────────────────────────── */

function isTruthySetting(value: string | undefined) {
	return ["true", "1", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

export function parseAlertTelegramChatIds(value: string | undefined | null): string[] {
	return String(value ?? "")
		.split(/[\n,;，；]+/)
		.map((item) => item.trim())
		.filter(Boolean);
}

export function buildAlertTelegramBody(input: TelegramMessageInput): string {
	const context = (input.contextLines ?? []).filter(Boolean);
	if (context.length === 0) return input.message;
	return [input.message, "", ...context].join("\n");
}

export async function getTelegramConfig(): Promise<TelegramConfig> {
	const settings = await getAllSettings();
	return {
		enabled: isTruthySetting(settings["telegram.enabled"]),
		botToken: settings["telegram.botToken"]?.trim() ?? "",
		chatIds: parseAlertTelegramChatIds(settings["telegram.chatId"]),
	};
}

export function assertTelegramReady(config: TelegramConfig) {
	if (!config.enabled) throw new ValidationError("Telegram channel not enabled");
	if (!config.botToken) throw new ValidationError("Telegram Bot Token not configured");
	if (config.chatIds.length === 0) throw new ValidationError("Telegram Chat ID not configured");
}

/* ── Network adapter (overridable for tests) ──────────────── */

export type TelegramFetch = typeof fetch;

let fetchImpl: TelegramFetch = (...args) => fetch(...args);

export function __setTelegramFetch(impl: TelegramFetch | null) {
	fetchImpl = impl ?? ((...args) => fetch(...args));
}

/* ── Single sendMessage (low-level) ───────────────────────── */

type TelegramApiResponse = {
	ok: boolean;
	result?: { message_id?: number; chat?: { id?: number | string } };
	description?: string;
	error_code?: number;
};

export async function sendTelegramMessage(
	chatId: string,
	text: string,
	options: { botToken: string; parseMode?: "HTML" | "MarkdownV2" },
	fetcher: TelegramFetch = fetchImpl,
): Promise<TelegramDeliveryResult> {
	const endpoint = `https://api.telegram.org/bot${options.botToken}/sendMessage`;
	const response = await fetcher(endpoint, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			chat_id: chatId,
			text,
			disable_web_page_preview: true,
			...(options.parseMode ? { parse_mode: options.parseMode } : {}),
		}),
		signal: AbortSignal.timeout(15_000),
	});

	if (!response.ok) {
		let description = `HTTP ${response.status}`;
		try {
			const body = (await response.json()) as TelegramApiResponse;
			if (body?.description) description = body.description;
		} catch {
			// 非 JSON 错误响应, 保留 HTTP 状态描述
		}
		throw new Error(`Telegram API error: ${description}`);
	}

	const payload = (await response.json()) as TelegramApiResponse;
	if (!payload.ok) {
		throw new Error(`Telegram API error: ${payload.description ?? "unknown error"}`);
	}

	return {
		chatId,
		messageId: payload.result?.message_id,
	};
}

/* ── High-level: send to all configured chat IDs ──────────── */

export async function sendAlertTelegram(
	input: TelegramMessageInput,
): Promise<TelegramBatchDeliveryResult> {
	const config = await getTelegramConfig();
	assertTelegramReady(config);

	const text = buildAlertTelegramBody(input);
	const accepted: TelegramDeliveryResult[] = [];
	const rejected: { chatId: string; reason: string }[] = [];

	// Best-effort fan-out: each chat_id is independent. 单个 chat 失败不影响其它 chat.
	await Promise.allSettled(
		config.chatIds.map(async (chatId) => {
			try {
				const result = await sendTelegramMessage(chatId, text, { botToken: config.botToken });
				accepted.push(result);
			} catch (error) {
				rejected.push({ chatId, reason: error instanceof Error ? error.message : String(error) });
			}
		}),
	);

	return { accepted, rejected };
}
