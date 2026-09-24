/**
 * AI provider HTTP adapter.
 *
 * Centralises the fetch shape and the HTTP-error → Chinese message mapping for
 * the two outbound AI calls (model list and chat completion). The service layer
 * decides *what* to send (URL path, body shape, auth headers), this adapter
 * decides *how* to send it (HTTP method, JSON encoding, ok/!ok branching,
 * Chinese error copy).
 *
 * Why the error mapping lives here: callers should not need to know whether a
 * 401 means "wrong API key" or a 429 means "rate limited" — the adapter
 * formats the human-readable string for the kind of call being made.
 */

import { ValidationError } from "@/lib/errors";
import {
	assertPublicBaseUrlResolvesPublic,
	isUnsafePublicHttpHost,
} from "@/lib/storage/direct-access-url";
import { fetchWithPinnedDns } from "@/lib/security/pinned-fetch";
import { t } from "@/lib/i18n/service-translations";
import { readResponseTextLimited } from "@/lib/http/response-body";

export interface ProviderModelRow {
	id: string;
	name?: string;
	owned_by?: string;
	context_length?: number;
}

export interface ProviderModelsRequest {
	apiKey: string;
	baseUrl: string;
}

export interface ProviderChatRequest {
	url: string;
	body: Record<string, unknown>;
	headers?: Record<string, string>;
	signal?: AbortSignal;
}

const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
const MODELS_PATH = "/models";
const CHAT_PATH_SUFFIX = "/chat/completions";
/** Bound hung upstream AI hosts so model-list / chat routes cannot stall until platform kill. */
const AI_PROVIDER_MODELS_TIMEOUT_MS = 30_000;
/** Non-streaming chat: total cap covering headers + body (short, bounded payloads). */
const AI_PROVIDER_CHAT_TIMEOUT_MS = 90_000;
/**
 * Streaming chat: cap only the time-to-first-byte (headers arrival). A total
 * cap on the fetch signal also aborts the response body mid-read, which
 * truncated any reply that streamed longer than the cap; after headers the
 * stream watchdogs in consumeProviderChatStream (idle + generous total) own
 * the lifecycle instead.
 */
const AI_PROVIDER_CHAT_FIRST_BYTE_TIMEOUT_MS = 45_000;
const AI_PROVIDER_MODELS_MAX_BYTES = 5 * 1024 * 1024;
const AI_PROVIDER_ERROR_MAX_BYTES = 64 * 1024;
const AI_PROVIDER_MODELS_MAX_ROWS = 10_000;

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

export function trimProviderBaseUrl(value: string | undefined, fallback: string): string {
	return trimTrailingSlash((value?.trim() || fallback));
}

/** Re-validate a stored/derived provider URL at fetch time to prevent SSRF via stale DB rows. */
async function assertProviderUrlSafe(rawUrl: string): Promise<void> {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new ValidationError(t("backend.ai.invalidAiProviderUrl"));
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new ValidationError(t("backend.ai.aiProviderUrlMustUseHttpS"));
	}
	if (url.username || url.password) {
		throw new ValidationError(t("backend.ai.aiProviderUrlMustNotContainCredentials"));
	}
	if (isUnsafePublicHttpHost(url.hostname)) {
		throw new ValidationError(t("backend.ai.aiProviderUrlMustNotPointToA"));
	}
	await assertPublicBaseUrlResolvesPublic(url.origin);
}

export function defaultAiBaseUrl(): string {
	return DEFAULT_AI_BASE_URL;
}

export function aiHttpErrorMessage(
	status: number,
	errorText: string,
	kind: "models" | "chat",
): string {
	if (kind === "models") {
		if (status === 401 || status === 403) {
			return "Failed to fetch model list: the provider rejected the API Key";
		}
		if (status === 429) {
			return "Failed to fetch model list: provider rate limit reached; retry later";
		}
		if (status >= 500) {
			return `Failed to fetch model list: provider is temporarily unavailable (${status})`;
		}
		return `Failed to fetch model list (${status}); check the Base URL and provider compatibility`;
	}
	const trimmed = (errorText || "").trim();
	const body = (trimmed || "Unknown error").slice(0, 500);
	return `AI request failed (${status}): ${body}`;
}

async function fetchProviderResponse(
	url: string,
	init: RequestInit,
	kind: "models" | "chat",
	timeoutMs: number,
	callerSignal?: AbortSignal,
): Promise<Response> {
	try {
		// Pinned dispatch: assertProviderUrlSafe validated this URL a moment
		// ago; the fetch itself must connect to the address that validation
		// saw, not whatever DNS answers on a second resolution (rebinding).
		return await fetchWithPinnedDns(url, init);
	} catch (error) {
		if (callerSignal?.aborted) throw callerSignal.reason;
		const name =
			typeof error === "object" && error && "name" in error
				? String(error.name)
				: "";
		if (name === "TimeoutError" || name === "AbortError") {
			const operation = kind === "models" ? "model list request" : "chat request";
			throw new Error(`AI provider ${operation} timed out after ${timeoutMs / 1000} seconds`);
		}
		const message =
			typeof error === "object" && error && "message" in error
				? String(error.message)
				: "";
		const details = message ? `: ${message}` : "";
		throw new Error(`Unable to connect to AI provider${details}`);
	}
}

export async function fetchProviderModels(
	input: ProviderModelsRequest,
): Promise<ProviderModelRow[]> {
	if (!input.apiKey.trim()) {
		throw new ValidationError(t("backend.ai.apiKeyIsRequired"));
	}
	const baseUrl = trimTrailingSlash(input.baseUrl);
	await assertProviderUrlSafe(baseUrl);
	const response = await fetchProviderResponse(`${baseUrl}${MODELS_PATH}`, {
		method: "GET",
		redirect: "error",
		headers: { Authorization: `Bearer ${input.apiKey.trim()}` },
		signal: AbortSignal.timeout(AI_PROVIDER_MODELS_TIMEOUT_MS),
	}, "models", AI_PROVIDER_MODELS_TIMEOUT_MS);
	if (!response.ok) {
		const errText = await readResponseTextLimited(
			response,
			AI_PROVIDER_ERROR_MAX_BYTES,
		).catch(() => "");
		throw new Error(aiHttpErrorMessage(response.status, errText, "models"));
	}
	const rawBody = await readResponseTextLimited(
		response,
		AI_PROVIDER_MODELS_MAX_BYTES,
	).catch(() => {
		throw new Error("AI provider model response is invalid or too large");
	});
	const data = (() => {
		try {
			return JSON.parse(rawBody) as {
				data?: unknown;
				models?: unknown;
			};
		} catch {
			return {};
		}
	})();
	const candidates: unknown = Array.isArray(data?.data)
		? data.data
		: Array.isArray(data?.models)
			? data.models
			: [];
	const rawModels = ((candidates as ProviderModelRow[]) ?? []).slice(
		0,
		AI_PROVIDER_MODELS_MAX_ROWS,
	);
	const models = rawModels.filter(
		(m): m is ProviderModelRow =>
			typeof m?.id === "string" && m.id.trim().length > 0,
	);
	if (models.length === 0) {
		throw new Error("AI provider returned no usable models; please check the Base URL and provider compatibility");
	}
	return models;
}

export async function postProviderChat(input: ProviderChatRequest): Promise<Response> {
	input.signal?.throwIfAborted();
	await assertProviderUrlSafe(input.url);
	input.signal?.throwIfAborted();
	const isStreaming = input.body?.stream === true;
	const timeoutMs = isStreaming
		? AI_PROVIDER_CHAT_FIRST_BYTE_TIMEOUT_MS
		: AI_PROVIDER_CHAT_TIMEOUT_MS;
	// Streaming: AbortController + manual timer so the timeout can be disarmed
	// the moment headers arrive (an AbortSignal.timeout cannot be cleared, and
	// leaving it armed would abort the body mid-stream). The caller's signal
	// stays live for the whole body via the composite signal.
	let disarmFirstByteTimeout: (() => void) | undefined;
	let requestSignal: AbortSignal;
	if (isStreaming) {
		const firstByteController = new AbortController();
		const forwardAbort = () => firstByteController.abort(input.signal?.reason);
		if (input.signal?.aborted) forwardAbort();
		else input.signal?.addEventListener("abort", forwardAbort, { once: true });
		const timer = setTimeout(
			() => firstByteController.abort(new DOMException("The operation timed out", "TimeoutError")),
			AI_PROVIDER_CHAT_FIRST_BYTE_TIMEOUT_MS,
		);
		disarmFirstByteTimeout = () => {
			clearTimeout(timer);
			input.signal?.removeEventListener("abort", forwardAbort);
		};
		requestSignal = input.signal
			? AbortSignal.any([input.signal, firstByteController.signal])
			: firstByteController.signal;
	} else {
		requestSignal = input.signal
			? AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)])
			: AbortSignal.timeout(timeoutMs);
	}
	try {
		const response = await fetchProviderResponse(input.url, {
			method: "POST",
			redirect: "error",
			headers: {
				"Content-Type": "application/json",
				...(input.headers ?? {}),
			},
			body: JSON.stringify(input.body),
			signal: requestSignal,
		}, "chat", timeoutMs, input.signal);
		if (!response.ok) {
			const errText = await readResponseTextLimited(
				response,
				AI_PROVIDER_ERROR_MAX_BYTES,
			).catch(() => "");
			throw new Error(aiHttpErrorMessage(response.status, errText, "chat"));
		}
		return response;
	} finally {
		// Headers arrived: hand the body's lifecycle to the stream watchdogs.
		disarmFirstByteTimeout?.();
	}
}

export { CHAT_PATH_SUFFIX };
