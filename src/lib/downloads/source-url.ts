import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const DEFAULT_BLOCKED_HOSTNAME_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".lan",
  ".home",
  ".test",
  ".invalid",
];

type ValidateDownloadSourceUrlOptions = {
  blockedHostnameSuffixes?: string[];
};

export type DownloadSourceUrlValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

function isMagnetLink(value: string): boolean {
  return value.startsWith("magnet:?");
}

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return Number.NaN;
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : Number.NaN;
  });
  return bytes.every(Number.isInteger) ? bytes : null;
}

function isBlockedIpv4(bytes: number[]): boolean {
	const [a, b] = bytes;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b! >= 64 && b! <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b! >= 16 && b! <= 31) ||
		(a === 192 && b === 168) ||
		a! >= 224
	);
}

function normalizeIpv6(hostname: string): string {
  return hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

function isBlockedIpv6(hostname: string): boolean {
  const value = normalizeIpv6(hostname);
  return (
    value === "::1" ||
    value === "::" ||
    value.startsWith("fe80:") ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("ff") ||
    value.startsWith("::ffff:127.") ||
    value.startsWith("::ffff:10.") ||
    value.startsWith("::ffff:192.168.") ||
    value.startsWith("::ffff:169.254.")
  );
}

function expandIpv6Address(address: string): number[] | null {
  const normalized = address.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (!normalized.includes(":")) return null;
  const [headRaw, tailRaw] = normalized.split("::", 2);
  const head = headRaw ? headRaw.split(":").filter(Boolean) : [];
  const tail = tailRaw ? tailRaw.split(":").filter(Boolean) : [];
  const ipv4Tail = [...head, ...tail].at(-1);
  if (ipv4Tail?.includes(".")) {
  	const octets = ipv4Tail.split(".").map((part) => Number.parseInt(part, 10));
  	if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  	const first = ((octets[0]! << 8) | octets[1]!).toString(16);
  	const second = ((octets[2]! << 8) | octets[3]!).toString(16);
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

function isBlockedIpAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (!normalized) return true;
  if (normalized.includes(":")) {
  	const parts = expandIpv6Address(normalized);
  	if (!parts || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff)) return true;
  	const allZero = parts.every((part) => part === 0);
  	const loopback = parts.slice(0, 7).every((part) => part === 0) && parts[7]! === 1;
  	const uniqueLocal = (parts[0]! & 0xfe00) === 0xfc00;
  	const linkLocal = (parts[0]! & 0xffc0) === 0xfe80;
  	const multicast = (parts[0]! & 0xff00) === 0xff00;
  	const ipv4Mapped = parts.slice(0, 5).every((part) => part === 0) && parts[5]! === 0xffff;
  	if (ipv4Mapped) {
  		return isBlockedIpAddress(`${(parts[6]! >> 8) & 255}.${parts[6]! & 255}.${(parts[7]! >> 8) & 255}.${parts[7]! & 255}`);
  	}
  	return allZero || loopback || uniqueLocal || linkLocal || multicast;
  }

  const ipv4 = parseIpv4(normalized);
  return ipv4 ? isBlockedIpv4(ipv4) || (ipv4[0]! === 198 && (ipv4[1]! === 18 || ipv4[1]! === 19)) : false;
  }

function hostnameMatchesBlockedSuffix(hostname: string, suffixes: string[]): boolean {
  const lower = hostname.toLowerCase();
  return suffixes.some((suffix) => {
    const normalized = suffix.toLowerCase().startsWith(".") ? suffix.toLowerCase() : `.${suffix.toLowerCase()}`;
    return lower === normalized.slice(1) || lower.endsWith(normalized);
  });
}

export function validateDownloadSourceUrl(
  rawUrl: string,
  options: ValidateDownloadSourceUrlOptions = {},
): DownloadSourceUrlValidationResult {
  const syntax = validateDownloadSourceUrlSyntax(rawUrl, options);
  return syntax.ok ? { ok: true } : { ok: false, reason: syntax.reason };
}

type DownloadSourceUrlSyntaxResult =
  | { ok: false; reason: string }
  | { ok: true; url: URL; magnet: boolean };

function validateDownloadSourceUrlSyntax(
  rawUrl: string,
  options: ValidateDownloadSourceUrlOptions = {},
): DownloadSourceUrlSyntaxResult {
  const value = (rawUrl ?? "").trim();
  if (!value) return { ok: false, reason: "下载链接不能为空" };
  if (value.length > 4096) return { ok: false, reason: "下载链接过长" };
  if (isMagnetLink(value)) return { ok: true, url: new URL("http://magnet.invalid"), magnet: true };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: "下载链接格式无效" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "仅支持 HTTP、HTTPS 或 magnet 链接" };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: "下载链接不允许包含用户名或密码" };
  }

  if (parsed.port) {
    return { ok: false, reason: "下载链接不允许指定端口" };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) return { ok: false, reason: "下载链接缺少主机名" };

  const blockedSuffixes = options.blockedHostnameSuffixes ?? DEFAULT_BLOCKED_HOSTNAME_SUFFIXES;
  if (hostnameMatchesBlockedSuffix(hostname, blockedSuffixes)) {
    return { ok: false, reason: "不允许下载内网或本地域名资源" };
  }

  if (isIP(hostname) && isBlockedIpAddress(hostname)) {
    return { ok: false, reason: "不允许下载内网、回环或链路本地地址资源" };
  }

  const ipv4 = parseIpv4(hostname);
  if (ipv4 && isBlockedIpv4(ipv4)) {
    return { ok: false, reason: "不允许下载内网、回环或链路本地地址资源" };
  }

  if (hostname.includes(":") && isBlockedIpv6(hostname)) {
    return { ok: false, reason: "不允许下载内网、回环或链路本地 IPv6 地址资源" };
  }

  return { ok: true, url: parsed, magnet: false };
}

export async function assertDownloadSourceUrlSafe(
  rawUrl: string,
  options: ValidateDownloadSourceUrlOptions = {},
): Promise<DownloadSourceUrlValidationResult> {
  const syntax = validateDownloadSourceUrlSyntax(rawUrl, options);
  if (!syntax.ok) return { ok: false, reason: syntax.reason };
  if (syntax.magnet) return { ok: true };

  const hostname = syntax.url.hostname.toLowerCase();
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some((entry) => isBlockedIpAddress(entry.address))) {
      return { ok: false, reason: "下载链接 DNS 解析到内网、回环或链路本地地址" };
    }
  } catch {
    return { ok: false, reason: "下载链接 DNS 解析失败" };
  }

  return { ok: true };
}
