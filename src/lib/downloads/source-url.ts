import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { isMagnetLink } from "@/lib/downloads/helpers";
import { isBlockedIpAddress } from "@/lib/security/ip-blocklist";

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
  // returns 0 for a bracketed form — strip them so every IP literal (incl.
  // IPv4-mapped/compatible forms) is vetted by the shared isBlockedIpAddress.
  const ipLiteral = hostname.replace(/^\[(.*)\]$/u, "$1");

  const blockedSuffixes = options.blockedHostnameSuffixes ?? DEFAULT_BLOCKED_HOSTNAME_SUFFIXES;
  if (hostnameMatchesBlockedSuffix(hostname, blockedSuffixes)) {
    return { ok: false, reason: "Downloading intranet or local domain resources is not allowed" };
  }

  if (isIP(ipLiteral) && isBlockedIpAddress(ipLiteral)) {
    return { ok: false, reason: "Downloading intranet, loopback, or link-local address resources is not allowed" };
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
