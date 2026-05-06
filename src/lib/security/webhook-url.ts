import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain"]);

function expandIpv6Address(address: string) {
	const normalized = address.toLowerCase();
	if (!normalized.includes(":")) return null;
	const [headRaw, tailRaw] = normalized.split("::", 2);
	const head = headRaw ? headRaw.split(":").filter(Boolean) : [];
	const tail = tailRaw ? tailRaw.split(":").filter(Boolean) : [];
	const ipv4Tail = [...head, ...tail].at(-1);
	if (ipv4Tail?.includes(".")) {
		const octets = ipv4Tail.split(".").map((part) => Number.parseInt(part, 10));
		if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
		const first = ((octets[0] << 8) | octets[1]).toString(16);
		const second = ((octets[2] << 8) | octets[3]).toString(16);
		if (tail.length && tail.at(-1) === ipv4Tail) tail.splice(tail.length - 1, 1, first, second);
		else head.splice(head.length - 1, 1, first, second);
	}
	if (normalized.includes("::")) {
		const missing = 8 - head.length - tail.length;
		if (missing < 0) return null;
		return [...head, ...Array(missing).fill("0"), ...tail].map((part) => Number.parseInt(part || "0", 16));
	}
	const parts = head.map((part) => Number.parseInt(part || "0", 16));
	return parts.length === 8 ? parts : null;
}

function isBlockedIpAddress(address: string) {
	const normalized = address.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
	if (!normalized) return true;
	if (normalized.includes(":")) {
		const parts = expandIpv6Address(normalized);
		if (!parts || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff)) return true;
		const allZero = parts.every((part) => part === 0);
		const loopback = parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1;
		const uniqueLocal = (parts[0] & 0xfe00) === 0xfc00;
		const linkLocal = (parts[0] & 0xffc0) === 0xfe80;
		const multicast = (parts[0] & 0xff00) === 0xff00;
		const ipv4Mapped = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
		if (ipv4Mapped) {
			return isBlockedIpAddress(`${(parts[6] >> 8) & 255}.${parts[6] & 255}.${(parts[7] >> 8) & 255}.${parts[7] & 255}`);
		}
		return allZero || loopback || uniqueLocal || linkLocal || multicast;
	}

	const parts = normalized.split(".").map((part) => Number.parseInt(part, 10));
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
	const [a, b] = parts;
	return a === 0
		|| a === 10
		|| a === 127
		|| (a === 100 && b >= 64 && b <= 127)
		|| (a === 169 && b === 254)
		|| (a === 172 && b >= 16 && b <= 31)
		|| (a === 192 && b === 168)
		|| (a === 198 && (b === 18 || b === 19))
		|| a >= 224;
}

export function validateWebhookUrlSyntax(value: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return { ok: false as const, error: "Webhook URL 格式无效" };
	}
	if (url.protocol !== "https:") return { ok: false as const, error: "Webhook URL 必须使用 https://" };
	if (url.username || url.password) return { ok: false as const, error: "Webhook URL 不允许包含用户名或密码" };
	const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
	if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith(".localhost")) {
		return { ok: false as const, error: "Webhook URL 不允许指向本机或内网地址" };
	}
	if (isIP(hostname) && isBlockedIpAddress(hostname)) {
		return { ok: false as const, error: "Webhook URL 不允许指向本机或内网地址" };
	}
	if (hostname.endsWith(".internal") || hostname.endsWith(".local") || hostname.endsWith(".lan")) {
		return { ok: false as const, error: "Webhook URL 不允许指向内部域名" };
	}
	return { ok: true as const, url: url.toString() };
}

export async function assertWebhookUrlSafeForServerFetch(value: string) {
	const syntax = validateWebhookUrlSyntax(value);
	if (!syntax.ok) return syntax;
	const hostname = new URL(syntax.url).hostname;
	try {
		const addresses = await lookup(hostname, { all: true, verbatim: true });
		if (addresses.length === 0 || addresses.some((entry) => isBlockedIpAddress(entry.address))) {
			return { ok: false as const, error: "Webhook URL DNS 解析到本机或内网地址" };
		}
	} catch {
		return { ok: false as const, error: "Webhook URL DNS 解析失败" };
	}
	return syntax;
}

export async function fetchWebhookSafely(url: string, init: Omit<Dispatcher.RequestOptions, "origin" | "path">) {
	const safe = await assertWebhookUrlSafeForServerFetch(url);
	if (!safe.ok) return safe;
	const parsed = new URL(safe.url);
	const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
	if (addresses.length === 0 || addresses.some((entry) => isBlockedIpAddress(entry.address))) {
		return { ok: false as const, error: "Webhook URL DNS 解析到本机或内网地址" };
	}
	const pinned = addresses[0];
	const dispatcher = new Agent({
		connect: {
			lookup(hostname, options, callback) {
				if (hostname !== parsed.hostname) {
					callback(new Error("Webhook URL 重定向目标未验证"), undefined as never, undefined as never);
					return;
				}
				if (typeof options === "object" && options?.all) {
					callback(null, [{ address: pinned.address, family: pinned.family }], undefined as never);
					return;
				}
				callback(null, pinned.address, pinned.family);
			},
		},
	});
	try {
		const requestInit = { ...init, dispatcher, redirect: "error" } as unknown as Parameters<typeof undiciFetch>[1];
		const response = await undiciFetch(safe.url, requestInit);
		return { ok: true as const, response };
	} catch {
		return { ok: false as const, error: "Webhook 请求失败" };
	} finally {
		await dispatcher.close();
	}
}
