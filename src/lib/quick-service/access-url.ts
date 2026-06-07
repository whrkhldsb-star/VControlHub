export function normalizeQuickServicePublicHost(raw?: string | null): string | null {
	const trimmed = raw?.trim();
	if (!trimmed) return null;
	return trimmed.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

export function normalizeQuickServicePath(raw?: string | null): string {
	const trimmed = raw?.trim();
	if (!trimmed || trimmed === ".") return "/";
	if (/^https?:\/\//i.test(trimmed)) {
		try {
			const parsed = new URL(trimmed);
			return `${parsed.pathname || "/"}${parsed.search}${parsed.hash}`;
		} catch {
			return "/";
		}
	}
	return `/${trimmed.replace(/^\/+/, "")}`.replace(/\/+/g, "/");
}

export function buildQuickServiceAccessUrl(input: {
	port?: number | null;
	defaultPort: number;
	browserHost?: string | null;
	configuredHost?: string | null;
	protocol?: string | null;
	path?: string | null;
}): string | null {
	const port = input.port ?? input.defaultPort;
	if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

	const configured = normalizeQuickServicePublicHost(input.configuredHost);
	const host = configured ?? normalizeQuickServicePublicHost(input.browserHost);
	if (!host) return null;

	const explicitScheme = input.configuredHost?.trim().match(/^(https?):\/\//i)?.[1];
	const browserScheme = input.protocol?.replace(":", "").toLowerCase();
	const scheme = explicitScheme ?? (browserScheme === "https" && !configured ? "https" : "http");
	const hostWithoutPort = host.replace(/:\d+$/, "");
	return `${scheme}://${hostWithoutPort}:${port}${normalizeQuickServicePath(input.path)}`;
}
