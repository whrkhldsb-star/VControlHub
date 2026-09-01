import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { isMagnetLink } from "@/lib/downloads/helpers";

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
  | { ok: true; resolution?: DownloadSourceResolution }
  | { ok: false; reason: string };

export type DownloadSourceResolution = {
  hostname: string;
  address: string;
  port: 80 | 443;
};

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
    // Both IPv4-mapped (::ffff:a.b.c.d) and the deprecated IPv4-compatible
    // (::a.b.c.d — top 96 bits zero) form embed an IPv4 address in the low 32
    // bits. Evaluate under IPv4 rules so e.g. ::127.0.0.1 or ::169.254.169.254
    // cannot bypass the private-range block (mirrors security/webhook-url.ts).
    const ipv4Compatible = parts.slice(0, 6).every((part) => part === 0);
    if (ipv4Mapped || ipv4Compatible) {
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
  if (!value) return { ok: false, reason: "Download URL cannot be empty" };
  if (value.length > 4096) return { ok: false, reason: "Download URL is too long" };
  if (isMagnetLink(value)) return { ok: true, url: new URL("http://magnet.invalid"), magnet: true };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: "Download URL format is invalid" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "Only HTTP, HTTPS, or magnet links are supported" };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: "Download URL must not contain username or password" };
  }

  if (parsed.port) {
    return { ok: false, reason: "Download URL must not specify a port" };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) return { ok: false, reason: "Download URL is missing a hostname" };
  // URL.hostname keeps the brackets on an IPv6 literal ("[::1]"), and isIP()
  // returns 0 for a bracketed form — which previously bypassed the robust
  // isBlockedIpAddress checker and left literal IPv6 URLs to the weaker
  // prefix-string isBlockedIpv6 fallback. Strip brackets so every IP literal
  // (incl. IPv4-mapped/compatible forms) is vetted by isBlockedIpAddress.
  const ipLiteral = hostname.replace(/^\[(.*)\]$/u, "$1");

  const blockedSuffixes = options.blockedHostnameSuffixes ?? DEFAULT_BLOCKED_HOSTNAME_SUFFIXES;
  if (hostnameMatchesBlockedSuffix(hostname, blockedSuffixes)) {
    return { ok: false, reason: "Downloading intranet or local domain resources is not allowed" };
  }

  if (isIP(ipLiteral) && isBlockedIpAddress(ipLiteral)) {
    return { ok: false, reason: "Downloading intranet, loopback, or link-local address resources is not allowed" };
  }

  const ipv4 = parseIpv4(ipLiteral);
  if (ipv4 && isBlockedIpv4(ipv4)) {
    return { ok: false, reason: "Downloading intranet, loopback, or link-local address resources is not allowed" };
  }

  if (ipLiteral.includes(":") && isBlockedIpv6(ipLiteral)) {
    return { ok: false, reason: "Downloading intranet, loopback, or link-local IPv6 address resources is not allowed" };
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
      return { ok: false, reason: "Download URL DNS resolved to an intranet, loopback, or link-local address" };
    }
    const selected = addresses[0]!;
    return {
      ok: true,
      resolution: {
        hostname: hostname.replace(/^\[|\]$/g, ""),
        address: selected.address,
        port: syntax.url.protocol === "https:" ? 443 : 80,
      },
    };
  } catch {
    return { ok: false, reason: "Download URL DNS resolution failed" };
  }
}
