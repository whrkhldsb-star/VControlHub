/**
 * Detect whether the original client request used HTTPS.
 *
 * Behind reverse proxies (Caddy/Apache/nginx), Next often sees `http://`
 * on the internal hop. Prefer a positive `X-Forwarded-Proto: https` signal,
 * then fall back to the request URL protocol. Never treat a spoofed
 * `X-Forwarded-Proto: http` as authority to drop Secure when the URL is already https.
 */
export function isRequestHttps(request: Request): boolean {
  const proto = request.headers.get("x-forwarded-proto");
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
