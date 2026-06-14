import { ValidationError } from "@/lib/errors";

const PRIVATE_DIRECT_ACCESS_HOST_MESSAGE = "直连基础 URL 必须使用公网 HTTP(S) 地址，不能包含凭据、localhost、内网、回环或链路本地地址";
const PUBLIC_HTTP_URL_MESSAGE = "URL 必须使用公网 HTTP(S) 地址，不能包含凭据、localhost、内网、回环、链路本地或 metadata 地址";

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

  if (normalized.startsWith("::ffff:")) {
    return isIpv4PrivateOrSpecial(normalized.slice("::ffff:".length));
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
  if (!raw) throw new ValidationError("URL 不能为空");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError("URL 格式不正确");
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
    throw new ValidationError("直连基础 URL 格式不正确");
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
