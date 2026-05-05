/**
 * Simple in-memory sliding-window rate limiter.
 * Uses a Map of IP → { timestamps[] } to track requests within a window.
 * Suitable for single-instance deployments. For multi-instance, use Redis.
 */

type RateLimitEntry = {
  timestamps: number[];
};

type RateLimitConfig = {
  /** Max requests allowed within the window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
};

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: 10,
  windowMs: 60 * 1000, // 1 minute
};

const store = new Map<string, RateLimitEntry>();

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    const recent = entry.timestamps.filter((t) => now - t < DEFAULT_CONFIG.windowMs);
    if (recent.length === 0) {
      store.delete(key);
    } else {
      entry.timestamps = recent;
    }
  }
}, 5 * 60 * 1000);

/**
 * Check if a request from the given identifier should be allowed.
 * Returns { allowed: boolean, retryAfterMs: number }
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
): { allowed: boolean; retryAfterMs: number; remaining: number } {
  const now = Date.now();
  let entry = store.get(identifier);

  if (!entry) {
    entry = { timestamps: [] };
    store.set(identifier, entry);
  }

  // Filter to only timestamps within the window
  entry.timestamps = entry.timestamps.filter((t) => now - t < config.windowMs);

  if (entry.timestamps.length >= config.maxRequests) {
    const oldestInWindow = entry.timestamps[0];
    const retryAfterMs = oldestInWindow + config.windowMs - now;
    return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 0), remaining: 0 };
  }

  entry.timestamps.push(now);
  return { allowed: true, retryAfterMs: 0, remaining: config.maxRequests - entry.timestamps.length };
}

/** Extract client IP from request headers (handles Cloudflare/proxy) */
export function getClientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

/** Login-specific rate limit: 5 attempts per minute per IP */
export const LOGIN_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 5,
  windowMs: 60 * 1000,
};

/** Login-specific rate limit: 20 attempts per 15 minutes per IP (slower brute force) */
export const LOGIN_SLOW_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 20,
  windowMs: 15 * 60 * 1000,
};
