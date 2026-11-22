// Shared with the provider form, which must compare the effective origins even
// when one of the Base URL fields is empty.
export function resolveDefaultProviderBaseUrl(type?: string): string {
	if (type === "ANTHROPIC") return "https://api.anthropic.com";
	if (type === "GOOGLE") return "https://generativelanguage.googleapis.com";
	return "https://api.openai.com/v1";
}

/** A newly selected native provider cannot inherit the OpenAI model default. */
export function requiresExplicitDefaultModel(type?: string, previousType?: string): boolean {
	return type !== previousType && (type === "ANTHROPIC" || type === "GOOGLE");
}

export function providerOrigin(baseUrl: string | undefined, type?: string): string | null {
	try {
		return new URL(baseUrl?.trim() || resolveDefaultProviderBaseUrl(type)).origin;
	} catch {
		return null;
	}
}

type ProviderEndpoint = { type: string; baseUrl?: string };

export function providerEndpointChanged(previous: ProviderEndpoint, next: ProviderEndpoint): boolean {
	return previous.type !== next.type || providerOrigin(previous.baseUrl, previous.type) !== providerOrigin(next.baseUrl, next.type);
}

/** Ollama's local OpenAI-compatible API. Server-side use also requires the private host allowlist. */
export function isLocalOllamaEndpoint(baseUrl?: string, type?: string): boolean {
	if (type !== "OPENAI_COMPATIBLE" || !baseUrl) return false;
	try {
		const url = new URL(baseUrl);
		return url.port === "11434" && url.pathname.replace(/\/+$/, "") === "/v1";
	} catch {
		return false;
	}
}
