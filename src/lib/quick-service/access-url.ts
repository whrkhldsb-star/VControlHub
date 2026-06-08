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
		label: mode === "reverse-proxy" ? "反代 HTTPS" : "公开直连端口",
		description: mode === "reverse-proxy"
			? "该入口看起来由 HTTPS 反向代理承载，请确认反代已配置应用侧鉴权或网络隔离。"
			: "该入口会直接打开宿主机端口，不经过 VControlHub 登录鉴权；请只在防火墙、VPN 或应用自身鉴权就绪后暴露。",
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
