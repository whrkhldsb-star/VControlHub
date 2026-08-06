import { ValidationError } from "@/lib/errors";
import { lookup } from "node:dns/promises";
import { t } from "@/lib/i18n/service-translations";

const PRIVATE_DIRECT_ACCESS_HOST_MESSAGE = "Direct access base URL must use a public HTTP(S) address and must not contain credentials, localhost, intranet, loopback, or link-local addresses";
const PUBLIC_HTTP_URL_MESSAGE = "URL must use a public HTTP(S) address and must not contain credentials, localhost, intranet, loopback, link-local, or metadata addresses";

function isIpv4PrivateOrSpecial(hostname: string) {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  if (a === undefined || b === undefined) return true;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 88) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a >= 224 && a <= 239) ||
    a >= 240
  );
}

function expandIpv6Parts(address: string): number[] | null {
  const normalized = address.toLowerCase();
  if (!normalized.includes(":")) return null;
  const [headRaw, tailRaw] = normalized.split("::", 2);
  const head = headRaw ? headRaw.split(":").filter(Boolean) : [];
  const tail = tailRaw ? tailRaw.split(":").filter(Boolean) : [];
  const ipv4Tail = [...head, ...tail].at(-1);
  if (ipv4Tail?.includes(".")) {
    const octets = ipv4Tail.split(".").map((part) => Number.parseInt(part, 10));
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return null;
    }
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

function isIpv6PrivateOrSpecial(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!normalized.includes(":")) return false;

  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fe90:") ||
    normalized.startsWith("fea0:") ||
    normalized.startsWith("feb0:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("ff")
  ) {
    return true;
  }

  // IPv4-mapped IPv6: ::ffff:127.0.0.1 or ::ffff:7f00:1 (after URL hostname parse)
  const parts = expandIpv6Parts(normalized);
  if (parts && parts.length === 8) {
    const ipv4Mapped = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
    if (ipv4Mapped) {
      const dotted = `${(parts[6]! >> 8) & 255}.${parts[6]! & 255}.${(parts[7]! >> 8) & 255}.${parts[7]! & 255}`;
      return isIpv4PrivateOrSpecial(dotted);
    }
  }

  if (normalized.startsWith("::ffff:")) {
    const rest = normalized.slice("::ffff:".length);
    if (rest.includes(".")) return isIpv4PrivateOrSpecial(rest);
    // hex form without full expand fallback
    if (parts) {
      const ipv4Mapped = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
      if (ipv4Mapped) {
        const dotted = `${(parts[6]! >> 8) & 255}.${parts[6]! & 255}.${(parts[7]! >> 8) & 255}.${parts[7]! & 255}`;
        return isIpv4PrivateOrSpecial(dotted);
      }
    }
  }

  return false;
}

export function isUnsafePublicHttpHost(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "").trim();
  if (!normalized) return true;
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "0.0.0.0" ||
    normalized === "metadata.google.internal"
  ) {
    return true;
  }
  return isIpv4PrivateOrSpecial(normalized) || isIpv6PrivateOrSpecial(normalized);
}

export function normalizePublicHttpUrl(value: string | null | undefined, message = PUBLIC_HTTP_URL_MESSAGE) {
  const raw = value?.trim();
  if (!raw) throw new ValidationError(t("backend.storage.urlRequired"));

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError(t("backend.storage.invalidUrlFormat"));
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ValidationError(message);
  }
  if (url.username || url.password) {
    throw new ValidationError(message);
  }
  if (isUnsafePublicHttpHost(url.hostname)) {
    throw new ValidationError(message);
  }

  url.hash = "";
  return url.toString();
}

export function normalizePublicBaseUrl(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError(t("backend.storage.invalidDirectAccessBaseUrl"));
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ValidationError(PRIVATE_DIRECT_ACCESS_HOST_MESSAGE);
  }
  if (url.username || url.password) {
    throw new ValidationError(PRIVATE_DIRECT_ACCESS_HOST_MESSAGE);
  }
  if (isUnsafePublicHttpHost(url.hostname)) {
    throw new ValidationError(PRIVATE_DIRECT_ACCESS_HOST_MESSAGE);
  }

  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

export function safeNormalizePublicBaseUrl(value: string | null | undefined) {
  try {
    return { ok: true as const, value: normalizePublicBaseUrl(value) };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : PRIVATE_DIRECT_ACCESS_HOST_MESSAGE,
    };
  }
}

/** Resolve immediately before a server-side request to prevent DNS rebinding. */
export async function assertPublicBaseUrlResolvesPublic(value: string) {
	const normalized = normalizePublicBaseUrl(value);
	if (!normalized) throw new ValidationError(PRIVATE_DIRECT_ACCESS_HOST_MESSAGE);
	const hostname = new URL(normalized).hostname;
	let addresses: Array<{ address: string; family: number }>;
	try {
		addresses = await lookup(hostname, { all: true, verbatim: true });
	} catch {
		throw new ValidationError(t("backend.storage.directAccessDnsFailed"));
	}
	if (addresses.length === 0 || addresses.some((entry) => isUnsafePublicHttpHost(entry.address))) {
		throw new ValidationError(PRIVATE_DIRECT_ACCESS_HOST_MESSAGE);
	}
	return normalized;
}
