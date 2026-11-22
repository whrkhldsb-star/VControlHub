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

import { resolveOutboundAddresses } from "@/lib/security/outbound-dns";
import { MAX_PROVIDER_MODELS, providerModelIdSchema } from "./schema";
import { BlockList, isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { ValidationError } from "@/lib/errors";
import { isUnsafePublicHttpHost } from "@/lib/storage/direct-access-url";
import { fetchWithPinnedDns, isLinkLocalAddress } from "@/lib/security/pinned-fetch";
import { config } from "@/lib/config/env";
import { t } from "@/lib/i18n/service-translations";
import { currentCopyLocale } from "@/lib/i18n/api-copy";
import { readResponseTextLimited } from "@/lib/http/response-body";
import { isLocalOllamaEndpoint, resolveDefaultProviderBaseUrl } from "./provider-endpoint";
import { AiProviderHttpError } from "./provider-errors";

export interface ProviderModelRow {
	id: string;
	name?: string;
	owned_by?: string;
	context_length?: number;
}

export interface ProviderModelsRequest {
	apiKey: string;
	baseUrl: string;
	/** Provider type: Anthropic authenticates and pages its model list its own way. */
	type?: string;
}

export interface ProviderChatRequest {
	url: string;
	body: Record<string, unknown>;
	headers?: Record<string, string>;
	signal?: AbortSignal;
}

export { resolveDefaultProviderBaseUrl };

export function allowsKeylessProvider(url: string, type?: string) {
	return isLocalOllamaEndpoint(url, type) && isListedPrivateProviderHost(url);
}

const localNetworks = new BlockList();
localNetworks.addSubnet("127.0.0.0", 8);
localNetworks.addSubnet("10.0.0.0", 8);
localNetworks.addSubnet("172.16.0.0", 12);
localNetworks.addSubnet("192.168.0.0", 16);
localNetworks.addSubnet("100.64.0.0", 10);
localNetworks.addAddress("::1", "ipv6");
localNetworks.addSubnet("fc00::", 7, "ipv6");

function localProviderAddress(address: string) {
	return !isLinkLocalAddress(address) && localNetworks.check(address, isIP(address) === 6 ? "ipv6" : "ipv4");
}

function publicHttpError() {
	return new ValidationError(currentCopyLocale() === "en" ? "Public AI providers require HTTPS" : "公网 AI 提供方必须使用 HTTPS");
}

export function checkProviderTransport(url: URL) {
	const host = url.hostname.replace(/^\[|\]$/g, "");
	if (url.protocol === "http:" && (!isListedPrivateProviderHost(url.href) || (isIP(host) && !localProviderAddress(host)))) {
		throw publicHttpError();
	}
}
const MODELS_PATH = "/models";
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
function dnsDeadline(signal?: AbortSignal | null) {
	const timeout = AbortSignal.timeout(15_000);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

export function trimProviderBaseUrl(value: string | undefined, fallback: string): string {
	return trimTrailingSlash((value?.trim() || fallback));
}

/**
 * Whether the operator listed this provider host as allowed on a private network (AI_PROVIDER_PRIVATE_HOSTS): a
 * local Ollama or LM Studio could not be added at all, every provider address had to resolve to a public one.
 */
export function isListedPrivateProviderHost(rawUrl: string): boolean {
	let hostname: string;
	try {
		hostname = new URL(rawUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
	} catch {
		return false;
	}
	return config.ai.privateProviderHosts.includes(hostname);
}

/** Re-validate a stored/derived provider URL at fetch time to prevent SSRF via stale DB rows. */
async function assertProviderUrlSafe(rawUrl: string, signal?: AbortSignal): Promise<void> {
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
	if (isListedPrivateProviderHost(rawUrl)) {
		// Listed by the operator: a private or loopback address is fine, link-local (cloud metadata) never is.
		if (isLinkLocalAddress(url.hostname)) throw new ValidationError(t("backend.ai.aiProviderUrlMustNotPointToA"));
		return;
	}
	if (isUnsafePublicHttpHost(url.hostname)) {
		throw new ValidationError(t("backend.ai.aiProviderUrlMustNotPointToA"));
	}
	const addresses = await resolveOutboundAddresses(url.hostname, dnsDeadline(signal)).catch(() => {
		signal?.throwIfAborted();
		throw new ValidationError(t("backend.storage.directAccessDnsFailed"));
	});
	if (!addresses.length || addresses.some(({ address }) => isUnsafePublicHttpHost(address))) {
		throw new ValidationError(t("backend.ai.aiProviderUrlMustNotPointToA"));
	}
	checkProviderTransport(url);
}

/** The native adapters append /messages or /chat/completions to an API root. */
export function providerApiRoot(value: string | undefined, type?: string): string {
	const official = resolveDefaultProviderBaseUrl(type);
	const baseUrl = trimProviderBaseUrl(value, official);
	let parsed: URL;
	try {
		parsed = new URL(baseUrl);
	} catch {
		throw new ValidationError(t("backend.ai.invalidAiProviderUrl"));
	}
	if (parsed.search || baseUrl.includes("?")) throw new ValidationError(t("backend.ai.invalidAiProviderUrl"));
	parsed.hash = "";
	if (type === "ANTHROPIC" || type === "GOOGLE") {
		// Older rows could contain the generic database default for either native type.
		if (parsed.hostname.replace(/\.$/, "") === "api.openai.com") {
			throw new ValidationError(t("backend.ai.invalidAiProviderUrl"));
		}
		if (parsed.origin === official && parsed.pathname === "/" && !parsed.username && !parsed.password) {
			return official + (type === "ANTHROPIC" ? "/v1" : "/v1beta/openai");
		}
	}
	return trimTrailingSlash(parsed.href);
}

export function aiHttpErrorMessage(
	status: number,
	_errorText: string,
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
	const category = status === 401 || status === 403 ? "access denied"
		: status === 429 ? "rate limited" : status >= 500 ? "provider unavailable" : "request rejected";
	return `AI request failed (${status}): ${category}`;
}

/** Preserve the HTTP virtual host while connecting only to verified private addresses. */
async function fetchPrivateHttpProvider(url: URL, init: RequestInit): Promise<Response> {
	checkProviderTransport(url);
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	const addresses = await resolveOutboundAddresses(hostname, dnsDeadline(init.signal));
	if (!addresses.length || addresses.some(({ address }) => !localProviderAddress(address))) throw publicHttpError();
	init.signal?.throwIfAborted();
	const first = addresses[0]!;
	const dispatcher = new Agent({
		connect: {
			timeout: 15_000,
			lookup(name, options, callback) {
				if (name !== hostname) {
					callback(new Error("Unexpected provider host"), undefined as never, undefined as never);
				} else if (options.all) {
					callback(null, addresses, undefined as never);
				} else {
					callback(null, first.address, first.family);
				}
			},
		},
	});
	try {
		const response = await undiciFetch(url, { ...init, redirect: "error", dispatcher } as Parameters<typeof undiciFetch>[1]);
		return response as unknown as Response;
	} finally {
		// Graceful close lets the caller consume or cancel an in-flight streaming response.
		void dispatcher.close().catch(() => dispatcher.destroy()).catch(() => undefined);
	}
}

async function fetchProviderResponse(
	url: string,
	init: RequestInit,
	kind: "models" | "chat",
	timeoutMs: number,
	callerSignal?: AbortSignal,
): Promise<Response> {
	try {
		const endpoint = new URL(url);
		if (endpoint.protocol === "http:") return await fetchPrivateHttpProvider(endpoint, init);
		// Pinned dispatch: assertProviderUrlSafe validated this URL a moment
		// ago; the fetch itself must connect to the address that validation
		// saw, not whatever DNS answers on a second resolution (rebinding).
		return await fetchWithPinnedDns(url, init, { allowPrivateAddress: isListedPrivateProviderHost(url) });
	} catch (error) {
		if (error instanceof ValidationError) throw error;
		if (callerSignal?.aborted) throw callerSignal.reason;
		const name =
			typeof error === "object" && error && "name" in error
				? String(error.name)
				: "";
		if (name === "TimeoutError" || name === "AbortError") {
			const operation = kind === "models" ? "model list request" : "chat request";
			throw new Error(`AI provider ${operation} timed out after ${timeoutMs / 1000} seconds`);
		}
		throw new Error("Unable to connect to AI provider");
	}
}

export async function fetchProviderModels(
	input: ProviderModelsRequest,
): Promise<ProviderModelRow[]> {
	if (!input.apiKey.trim() && !allowsKeylessProvider(input.baseUrl, input.type)) {
		throw new ValidationError(t("backend.ai.apiKeyIsRequired"));
	}
	const baseUrl = providerApiRoot(input.baseUrl, input.type);
	const signal = AbortSignal.timeout(AI_PROVIDER_MODELS_TIMEOUT_MS);
	await assertProviderUrlSafe(baseUrl, signal);
	const anthropic = input.type === "ANTHROPIC";
	const url = new URL(baseUrl + MODELS_PATH);
	if (anthropic) url.searchParams.set("limit", "1000");
	const cursors = new Set<string>();
	const models = new Map<string, ProviderModelRow>();
	let remainingBytes = AI_PROVIDER_MODELS_MAX_BYTES;
	let remainingRows = MAX_PROVIDER_MODELS;
	for (;;) {
		signal.throwIfAborted();
		const response = await fetchProviderResponse(url.href, {
			method: "GET", redirect: "error", signal,
			headers: anthropic
				? { "x-api-key": input.apiKey.trim(), "anthropic-version": "2023-06-01" }
				: input.apiKey.trim() ? { Authorization: `Bearer ${input.apiKey.trim()}` } : {},
		}, "models", AI_PROVIDER_MODELS_TIMEOUT_MS);
		if (!response.ok) {
			const errText = await readResponseTextLimited(response, AI_PROVIDER_ERROR_MAX_BYTES).catch(() => "");
			throw new AiProviderHttpError(aiHttpErrorMessage(response.status, errText, "models"), response.status, errText, response.headers.get("retry-after"));
		}
		const rawBody = await readResponseTextLimited(response, remainingBytes).catch(() => {
			throw new Error("AI provider model response is invalid or too large");
		});
		remainingBytes -= Buffer.byteLength(rawBody);
		let page: { data?: unknown; models?: unknown; has_more?: unknown; last_id?: unknown } | null;
		try {
			page = JSON.parse(rawBody);
		} catch {
			throw new Error("AI provider model response is invalid or too large");
		}
		const rows: unknown[] = Array.isArray(page?.data) ? page.data : Array.isArray(page?.models) ? page.models : [];
		if (anthropic && rows.length > remainingRows) throw new Error("AI provider model response is too large");
		for (const row of rows.slice(0, remainingRows)) {
			if (!row || typeof row !== "object" || !("id" in row)) continue;
			const id = providerModelIdSchema.safeParse(row.id);
			if (!id.success || models.has(id.data)) continue;
			const model: ProviderModelRow = { id: id.data };
			if ("name" in row && typeof row.name === "string") model.name = row.name;
			if ("owned_by" in row && typeof row.owned_by === "string") model.owned_by = row.owned_by;
			if ("context_length" in row && typeof row.context_length === "number" && Number.isSafeInteger(row.context_length) && row.context_length > 0) {
				model.context_length = row.context_length;
			}
			models.set(model.id, model);
		}
		remainingRows -= rows.length;
		if (!anthropic || page?.has_more !== true) break;
		if (remainingRows <= 0) throw new Error("AI provider model response is too large");
		const cursor = providerModelIdSchema.safeParse(page.last_id);
		if (!rows.length || !cursor.success || cursors.has(cursor.data)) throw new Error("Invalid AI provider model pagination");
		cursors.add(cursor.data);
		url.searchParams.set("after_id", cursor.data);
	}
	if (!models.size) throw new Error("AI provider returned no usable models; please check the Base URL and provider compatibility");
	return [...models.values()];
}

export async function postProviderChat(input: ProviderChatRequest): Promise<Response> {
	input.signal?.throwIfAborted();
	await assertProviderUrlSafe(input.url, input.signal);
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
			throw new AiProviderHttpError(aiHttpErrorMessage(response.status, errText, "chat"), response.status, errText, response.headers.get("retry-after"));
		}
		return response;
	} finally {
		// Headers arrived: hand the body's lifecycle to the stream watchdogs.
		disarmFirstByteTimeout?.();
	}
}
