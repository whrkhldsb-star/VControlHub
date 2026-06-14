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

import { BusinessError, ValidationError } from "@/lib/errors";

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

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

export function trimProviderBaseUrl(value: string | undefined, fallback: string): string {
	return trimTrailingSlash((value?.trim() || fallback));
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
		return "模型清单获取失败，请检查 API Key 和 Base URL";
	}
	const trimmed = (errorText || "").trim();
	const body = (trimmed || "Unknown error").slice(0, 500);
	return `AI 请求失败 (${status}): ${body}`;
}

export async function fetchProviderModels(
	input: ProviderModelsRequest,
): Promise<ProviderModelRow[]> {
	if (!input.apiKey.trim()) {
		throw new ValidationError("API Key 不能为空");
	}
	const baseUrl = trimTrailingSlash(input.baseUrl);
	const response = await fetch(`${baseUrl}${MODELS_PATH}`, {
		method: "GET",
		headers: { Authorization: `Bearer ${input.apiKey.trim()}` },
	});
	if (!response.ok) {
		const errText = await response.text().catch(() => "");
		throw new Error(aiHttpErrorMessage(response.status, errText, "models"));
	}
	const data = (await response.json().catch(() => ({}))) as {
		data?: unknown;
		models?: unknown;
	};
	const candidates: unknown = Array.isArray(data?.data)
		? data.data
		: Array.isArray(data?.models)
			? data.models
			: [];
	const rawModels = (candidates as ProviderModelRow[]) ?? [];
	return rawModels.filter(
		(m): m is ProviderModelRow =>
			typeof m?.id === "string" && m.id.trim().length > 0,
	);
}

export async function postProviderChat(input: ProviderChatRequest): Promise<Response> {
	const response = await fetch(input.url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(input.headers ?? {}),
		},
		body: JSON.stringify(input.body),
	});
	if (!response.ok) {
		const errText = await response.text().catch(() => "");
		throw new Error(aiHttpErrorMessage(response.status, errText, "chat"));
	}
	return response;
}

export { CHAT_PATH_SUFFIX };
