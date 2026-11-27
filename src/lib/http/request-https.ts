import { config } from "@/lib/config/env";

/**
 * Detect whether the original client request used HTTPS.
 *
 * Behind reverse proxies (Caddy/Apache/nginx), Next often sees `http://`
 * on the internal hop. Prefer a positive `X-Forwarded-Proto: https` signal,
 * then fall back to the request URL protocol. Never treat a spoofed
 * `X-Forwarded-Proto: http` as authority to drop Secure when the URL is already https.
 *
 * The forwarded header is believed only when a reverse proxy is trusted
 * (`TRUSTED_PROXY_HOPS` > 0), the same rule client-IP resolution follows: with
 * the app exposed directly (0 hops) the header is whatever the client sent.
 */
export function isRequestHttps(request: Request): boolean {
  const proto = (config.http?.trustedProxyHops ?? 1) > 0 ? request.headers.get("x-forwarded-proto") : null;
  if (proto) {
    // Proxies may send comma-separated values; take the left-most hop.
    const first = proto.split(",")[0]?.trim().toLowerCase();
    if (first === "https") return true;
  }

  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return request.url.startsWith("https://");
  }
}
