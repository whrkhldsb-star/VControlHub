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
}

const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
const MODELS_PATH = "/models";
const CHAT_PATH_SUFFIX = "/chat/completions";
/** Bound hung upstream AI hosts so model-list / chat routes cannot stall until platform kill. */
const AI_PROVIDER_HTTP_TIMEOUT_MS = 30_000;
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
): Promise<Response> {
	try {
		return await fetch(url, init);
	} catch (error) {
		const name =
			typeof error === "object" && error && "name" in error
				? String(error.name)
				: "";
		if (name === "TimeoutError" || name === "AbortError") {
			const operation = kind === "models" ? "model list request" : "chat request";
			throw new Error(`AI provider ${operation} timed out after ${AI_PROVIDER_HTTP_TIMEOUT_MS / 1000} seconds`);
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
		signal: AbortSignal.timeout(AI_PROVIDER_HTTP_TIMEOUT_MS),
	}, "models");
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
	await assertProviderUrlSafe(input.url);
	const response = await fetchProviderResponse(input.url, {
		method: "POST",
		redirect: "error",
		headers: {
			"Content-Type": "application/json",
			...(input.headers ?? {}),
		},
		body: JSON.stringify(input.body),
		signal: AbortSignal.timeout(AI_PROVIDER_HTTP_TIMEOUT_MS),
	}, "chat");
	if (!response.ok) {
		const errText = await readResponseTextLimited(
			response,
			AI_PROVIDER_ERROR_MAX_BYTES,
		).catch(() => "");
		throw new Error(aiHttpErrorMessage(response.status, errText, "chat"));
	}
	return response;
}

export { CHAT_PATH_SUFFIX };
