const PRIVATE_DIRECT_ACCESS_HOST_MESSAGE = "直连基础 URL 必须使用公网 HTTP(S) 地址，不能包含凭据、localhost、内网、回环或链路本地地址";

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

function isUnsafeHost(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "").trim();
  if (!normalized) return true;
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "0.0.0.0") {
    return true;
  }
  return isIpv4PrivateOrSpecial(normalized) || isIpv6PrivateOrSpecial(normalized);
}

export function normalizePublicBaseUrl(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("直连基础 URL 格式不正确");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(PRIVATE_DIRECT_ACCESS_HOST_MESSAGE);
  }
  if (url.username || url.password) {
    throw new Error(PRIVATE_DIRECT_ACCESS_HOST_MESSAGE);
  }
  if (isUnsafeHost(url.hostname)) {
    throw new Error(PRIVATE_DIRECT_ACCESS_HOST_MESSAGE);
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
