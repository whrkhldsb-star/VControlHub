export type QuickServiceAccessMode = "direct-port" | "reverse-proxy";

export type QuickServiceAccessDescriptor = {
	url: string;
	mode: QuickServiceAccessMode;
	label: string;
	description: string;
};

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

export function buildQuickServiceAccessDescriptor(input: {
	port?: number | null;
	defaultPort: number;
	browserHost?: string | null;
	configuredHost?: string | null;
	protocol?: string | null;
	path?: string | null;
}): QuickServiceAccessDescriptor | null {
	const port = input.port ?? input.defaultPort;
	if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

	const configured = normalizeQuickServicePublicHost(input.configuredHost);
	const host = configured ?? normalizeQuickServicePublicHost(input.browserHost);
	if (!host) return null;

	const explicitScheme = input.configuredHost?.trim().match(/^(https?):\/\//i)?.[1];
	const browserScheme = input.protocol?.replace(":", "").toLowerCase();
	const scheme = explicitScheme ?? (browserScheme === "https" && !configured ? "https" : "http");
	const hostWithoutPort = host.replace(/:\d+$/, "");
	const url = `${scheme}://${hostWithoutPort}:${port}${normalizeQuickServicePath(input.path)}`;
	const mode: QuickServiceAccessMode = scheme === "https" && port === 443 ? "reverse-proxy" : "direct-port";

	return {
		url,
		mode,
		label: mode === "reverse-proxy" ? "Reverse proxy HTTPS" : "Public direct port",
		description: mode === "reverse-proxy"
			? "This entry appears to be served by an HTTPS reverse proxy; please confirm the proxy has app-side authentication or network isolation configured."
			: "This entry opens the host port directly without going through VControlHub login authentication; please expose it only after firewall, VPN or the app's own authentication is ready.",
	};
}

export function buildQuickServiceAccessUrl(input: {
	port?: number | null;
	defaultPort: number;
	browserHost?: string | null;
	configuredHost?: string | null;
	protocol?: string | null;
	path?: string | null;
}): string | null {
	return buildQuickServiceAccessDescriptor(input)?.url ?? null;
}
