/**
 * Provider adapters for ITSM/IM outbound delivery.
 *
 * - generic_webhook / slack / dingtalk / feishu: HTTPS POST via fetchWebhookSafely
 * - telegram: Bot API sendMessage (public API host, not SSRF-sensitive private IPs)
 *
 * Live vendor SDKs are intentionally not required: failures surface as explicit
 * errors (no fake success). Tests inject fetch via __setItsmFetch.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { ValidationError } from "@/lib/errors";
import { fetchWebhookSafely, validateWebhookUrlSyntax } from "@/lib/security/webhook-url";
import { readResponseTextLimited } from "@/lib/http/response-body";

import { t } from "@/lib/i18n/service-translations";
import type {
	ItsmConnectionConfig,
	ItsmCredentials,
	ItsmOutboundResult,
	ItsmOutboundTicketPayload,
	ItsmProvider,
} from "./types";

export type ItsmFetch = typeof fetch;
const ITSM_RESPONSE_MAX_BYTES = 64 * 1024;
let fetchImpl: ItsmFetch = (...args) => fetch(...args);

export function __setItsmFetch(impl: ItsmFetch | null) {
	fetchImpl = impl ?? ((...args) => fetch(...args));
}

export function buildOutboundBody(
	provider: ItsmProvider,
	payload: ItsmOutboundTicketPayload,
	config: ItsmConnectionConfig,
): { contentType: string; body: string } {
	const base = {
		source: "vcontrolhub",
		eventType: payload.eventType,
		ticket: {
			id: payload.ticketId,
			title: payload.title,
			description: payload.description,
			status: payload.status,
			priority: payload.priority,
			category: payload.category ?? null,
		},
		comment: payload.commentBody ? { body: payload.commentBody } : undefined,
		workspace: config.workspace ?? null,
		timestamp: new Date().toISOString(),
	};

	const text = [
		`[VControlHub] ${payload.eventType}`,
		`#${payload.ticketId.slice(0, 8)} ${payload.title}`,
		`status=${payload.status} priority=${payload.priority}`,
		payload.commentBody ? `comment: ${payload.commentBody}` : payload.description.slice(0, 280),
	]
		.filter(Boolean)
		.join("\n");

	if (provider === "slack") {
		return {
			contentType: "application/json",
			body: JSON.stringify({ text, ...base }),
		};
	}
	if (provider === "dingtalk") {
		return {
			contentType: "application/json",
			body: JSON.stringify({
				msgtype: "text",
				text: { content: text },
				...base,
			}),
		};
	}
	if (provider === "feishu") {
		return {
			contentType: "application/json",
			body: JSON.stringify({
				msg_type: "text",
				content: { text },
				...base,
			}),
		};
	}
	if (provider === "telegram") {
		return {
			contentType: "application/json",
			body: JSON.stringify({
				chat_id: config.chatId,
				text,
				disable_web_page_preview: true,
			}),
		};
	}
	// generic_webhook
	return {
		contentType: "application/json",
		body: JSON.stringify(base),
	};
}

export async function deliverOutbound(input: {
	provider: ItsmProvider;
	config: ItsmConnectionConfig;
	credentials: ItsmCredentials;
	payload: ItsmOutboundTicketPayload;
}): Promise<ItsmOutboundResult> {
	const packed = buildOutboundBody(input.provider, input.payload, input.config);

	if (input.provider === "telegram") {
		const token = input.credentials.botToken?.trim();
		if (!token) return { ok: false, error: "Telegram botToken is not configured" };
		const chatId = input.config.chatId?.trim();
		if (!chatId) return { ok: false, error: "Telegram chatId is not configured" };
		const url = `https://api.telegram.org/bot${token}/sendMessage`;
		try {
			const res = await fetchImpl(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: packed.body,
				signal: AbortSignal.timeout(15_000),
			});
			const responseBody = await readResponseTextLimited(
				res,
				ITSM_RESPONSE_MAX_BYTES,
			).catch(() => "");
			if (!res.ok) {
				return {
					ok: false,
					statusCode: res.status,
					error: `Telegram API HTTP ${res.status}`,
					responseBody: responseBody.slice(0, 500),
				};
			}
			return { ok: true, statusCode: res.status, responseBody: responseBody.slice(0, 500) };
		} catch (err) {
			return {
				ok: false,
				error: err instanceof Error ? err.message : "Telegram delivery failed",
			};
		}
	}

	const webhookUrl = input.config.webhookUrl?.trim();
	if (!webhookUrl) return { ok: false, error: "webhookUrl is not configured" };
	const syntax = validateWebhookUrlSyntax(webhookUrl);
	if (!syntax.ok) return { ok: false, error: syntax.error };

	const headers: Record<string, string> = {
		"Content-Type": packed.contentType,
		"User-Agent": "VControlHub-ITSM/1.0",
		...(input.config.headers ?? {}),
	};
	if (input.credentials.accessToken) {
		headers.Authorization = `Bearer ${input.credentials.accessToken}`;
	}
	if (input.credentials.webhookSecret) {
		const sig = createHmac("sha256", input.credentials.webhookSecret)
			.update(packed.body)
			.digest("hex");
		headers["X-VControlHub-Signature"] = `sha256=${sig}`;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15_000);
	try {
		const result = await fetchWebhookSafely(syntax.url, {
			method: "POST",
			headers,
			body: packed.body,
			signal: controller.signal,
		});
		if (!result.ok) {
			return { ok: false, error: result.error };
		}
		const responseBody = await readResponseTextLimited(
			result.response,
			ITSM_RESPONSE_MAX_BYTES,
		).catch(() => "");
		if (!result.response.ok) {
			return {
				ok: false,
				statusCode: result.response.status,
				error: `Webhook HTTP ${result.response.status}`,
				responseBody: responseBody.slice(0, 500),
			};
		}
		return {
			ok: true,
			statusCode: result.response.status,
			responseBody: responseBody.slice(0, 500),
		};
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : "Webhook delivery failed",
		};
	} finally {
		clearTimeout(timer);
	}
}

export function verifyInboundSignature(input: {
	rawBody: string;
	headerSignature: string | null | undefined;
	secret: string | undefined;
}): { ok: true } | { ok: false; error: string } {
	const secret = input.secret?.trim();
	if (!secret) {
		// Open inbound without secret is rejected at service layer for pure inbound;
		// when secret missing here treat as soft pass only if explicitly allowed by caller.
		return { ok: false, error: "Inbound webhook secret is not configured" };
	}
	const header = (input.headerSignature ?? "").trim();
	if (!header) return { ok: false, error: "Missing signature header" };

	const provided = header.startsWith("sha256=") ? header.slice("sha256=".length) : header;
	const expected = createHmac("sha256", secret).update(input.rawBody).digest("hex");
	// HMAC-only: accept hex digest (binary or hex-string form). Do NOT accept raw secret
	// as a shared token — that weakens verification to bearer-secret equivalence.
	try {
		const a = Buffer.from(provided, "hex");
		const b = Buffer.from(expected, "hex");
		if (a.length > 0 && a.length === b.length && timingSafeEqual(a, b)) {
			return { ok: true };
		}
	} catch {
		// Invalid hex encoding — fall through to string compare of digests.
	}
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	if (a.length === b.length && timingSafeEqual(a, b)) {
		return { ok: true };
	}
	return { ok: false, error: "Invalid webhook signature" };
}

/** First non-empty trimmed string among the candidates, cut to `max` characters. */
function firstText(max: number, ...values: unknown[]): string | null {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) return value.trim().slice(0, max);
	}
	return null;
}

function objectField(raw: Record<string, unknown>, key: string): Record<string, unknown> {
	const value = raw[key];
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Map the loosely shaped payloads ITSM/IM providers send onto ticket fields.
 * The signature proves who sent the body, not that its fields are sane, so
 * every field is bounded before it reaches a ticket or the event log.
 */
export function normalizeInboundTicket(raw: Record<string, unknown>): {
	eventType: string;
	externalId: string | null;
	title: string | null;
	description: string | null;
	status: string | null;
	priority: string | null;
	category: string | null;
	ticketId: string | null;
	commentBody: string | null;
} {
	const ticket = objectField(raw, "ticket");
	const comment = objectField(raw, "comment");
	const text = firstText(10_000, raw.text, raw.message);
	return {
		eventType: firstText(64, raw.eventType, raw.type) ?? "ticket.update",
		externalId: firstText(256, raw.externalId, raw.id),
		title: firstText(256, ticket.title, raw.title) ?? (text ? text.slice(0, 120) : null),
		description: firstText(10_000, ticket.description, raw.description) ?? text,
		status: firstText(32, ticket.status, raw.status),
		priority: firstText(32, ticket.priority, raw.priority),
		category: firstText(64, ticket.category, raw.category),
		ticketId: firstText(64, ticket.id, raw.ticketId),
		commentBody: firstText(10_000, comment.body, raw.commentBody),
	};
}

export function assertOutboundReady(provider: ItsmProvider, config: ItsmConnectionConfig, credentials: ItsmCredentials) {
	if (provider === "telegram") {
		if (!credentials.botToken?.trim()) throw new ValidationError(t("backend.itsm.telegramBottokenIsRequired"));
		if (!config.chatId?.trim()) throw new ValidationError(t("backend.itsm.telegramChatidIsRequired"));
		return;
	}
	if (!config.webhookUrl?.trim()) throw new ValidationError(t("backend.itsm.webhookurlIsRequired"));
	const syntax = validateWebhookUrlSyntax(config.webhookUrl);
	if (!syntax.ok) throw new ValidationError(syntax.error);
}
