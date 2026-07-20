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

import { t } from "@/lib/i18n/translations";
import type {
	ItsmConnectionConfig,
	ItsmCredentials,
	ItsmOutboundResult,
	ItsmOutboundTicketPayload,
	ItsmProvider,
} from "./types";

export type ItsmFetch = typeof fetch;
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
			const responseBody = await res.text().catch(() => "");
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
		const responseBody = await result.response.text().catch(() => "");
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
	try {
		const a = Buffer.from(provided, "hex");
		const b = Buffer.from(expected, "hex");
		if (a.length !== b.length || !timingSafeEqual(a, b)) {
			return { ok: false, error: "Invalid webhook signature" };
		}
	} catch {
		// Non-hex signatures: compare utf8 digests of both sides as fallback (shared token)
		const a = Buffer.from(provided);
		const b = Buffer.from(expected);
		if (a.length === b.length && timingSafeEqual(a, b)) return { ok: true };
		// Also accept exact secret match as simple shared token mode
		const tokenA = Buffer.from(provided);
		const tokenB = Buffer.from(secret);
		if (tokenA.length === tokenB.length && timingSafeEqual(tokenA, tokenB)) return { ok: true };
		return { ok: false, error: "Invalid webhook signature" };
	}
	return { ok: true };
}

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
	const ticket =
		raw.ticket && typeof raw.ticket === "object" && !Array.isArray(raw.ticket)
			? (raw.ticket as Record<string, unknown>)
			: {};
	const comment =
		raw.comment && typeof raw.comment === "object" && !Array.isArray(raw.comment)
			? (raw.comment as Record<string, unknown>)
			: {};
	const text =
		typeof raw.text === "string"
			? raw.text
			: typeof raw.message === "string"
				? raw.message
				: null;

	const title =
		(typeof ticket.title === "string" && ticket.title.trim()) ||
		(typeof raw.title === "string" && raw.title.trim()) ||
		(text ? text.slice(0, 120) : null);
	const description =
		(typeof ticket.description === "string" && ticket.description.trim()) ||
		(typeof raw.description === "string" && raw.description.trim()) ||
		text;

	return {
		eventType:
			(typeof raw.eventType === "string" && raw.eventType.trim()) ||
			(typeof raw.type === "string" && raw.type.trim()) ||
			"ticket.update",
		externalId:
			(typeof raw.externalId === "string" && raw.externalId.trim()) ||
			(typeof raw.id === "string" && raw.id.trim()) ||
			null,
		title,
		description,
		status:
			(typeof ticket.status === "string" && ticket.status.trim()) ||
			(typeof raw.status === "string" && raw.status.trim()) ||
			null,
		priority:
			(typeof ticket.priority === "string" && ticket.priority.trim()) ||
			(typeof raw.priority === "string" && raw.priority.trim()) ||
			null,
		category:
			(typeof ticket.category === "string" && ticket.category.trim()) ||
			(typeof raw.category === "string" && raw.category.trim()) ||
			null,
		ticketId:
			(typeof ticket.id === "string" && ticket.id.trim()) ||
			(typeof raw.ticketId === "string" && raw.ticketId.trim()) ||
			null,
		commentBody:
			(typeof comment.body === "string" && comment.body.trim()) ||
			(typeof raw.commentBody === "string" && raw.commentBody.trim()) ||
			null,
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
