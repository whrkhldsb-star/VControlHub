import { ValidationError } from "@/lib/errors";
import { lookup } from "node:dns/promises";
import { t } from "@/lib/i18n/service-translations";
import { isBlockedIpAddress } from "@/lib/security/ip-blocklist";

const PRIVATE_DIRECT_ACCESS_HOST_MESSAGE = "Direct access base URL must use a public HTTP(S) address and must not contain credentials, localhost, intranet, loopback, or link-local addresses";
const PUBLIC_HTTP_URL_MESSAGE = "URL must use a public HTTP(S) address and must not contain credentials, localhost, intranet, loopback, link-local, or metadata addresses";

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
	return isBlockedIpAddress(normalized);
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
