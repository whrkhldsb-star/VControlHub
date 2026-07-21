/**
 * Rate limiting helpers.
 *
 * `checkRateLimit` is the legacy synchronous in-memory helper used by a few
 * browser-form/auth paths. New API guards should use `checkRateLimitAsync`,
 * which delegates to the shared rate-limit store and therefore uses Redis when
 * REDIS_URL is configured.
 */

import { getRateLimitStore } from "@/lib/rate-limit-store";

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
    const oldestInWindow = entry.timestamps[0]!;
    const retryAfterMs = oldestInWindow + config.windowMs - now;
    return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 0), remaining: 0 };
  }

  entry.timestamps.push(now);
  return { allowed: true, retryAfterMs: 0, remaining: config.maxRequests - entry.timestamps.length };
}

export async function checkRateLimitAsync(
  identifier: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
): Promise<{ allowed: boolean; retryAfterMs: number; remaining: number }> {
  const now = Date.now();
  const timestamps = await getRateLimitStore().addAndGetWindow(identifier, now, config.windowMs);

  if (timestamps.length > config.maxRequests) {
    const oldestInWindow = timestamps[0] ?? now;
    const retryAfterMs = oldestInWindow + config.windowMs - now;
    return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 0), remaining: 0 };
  }

  return { allowed: true, retryAfterMs: 0, remaining: Math.max(config.maxRequests - timestamps.length, 0) };
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

// ── Account lockout (per-username) ─────────────────────────────────
type LockoutEntry = {
	failCount: number;
	lockedUntil: number | null; // timestamp, null = not locked
	lastFailureAt: number;
};

const ACCOUNT_LOCKOUT_MAX_FAILURES = 5; // lock after N consecutive failures
const ACCOUNT_LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const ACCOUNT_FAILURE_RETENTION_MS = 15 * 60 * 1000;

const lockoutStore = new Map<string, LockoutEntry>();

// Clean up stale lockout entries every 10 minutes
setInterval(() => {
	const now = Date.now();
	for (const [key, entry] of lockoutStore) {
		if ((entry.lockedUntil && entry.lockedUntil < now) || now - entry.lastFailureAt >= ACCOUNT_FAILURE_RETENTION_MS) {
			lockoutStore.delete(key);
		}
	}
}, 10 * 60 * 1000);

/**
 * Record a failed login attempt for a username.
 * Returns the lockout status after recording.
 */
export function recordLoginFailure(username: string): { locked: boolean; lockedUntil: number | null; failCount: number } {
	const key = username.toLowerCase();
	const now = Date.now();
	let entry = lockoutStore.get(key);
	if (!entry || (entry.lockedUntil && entry.lockedUntil < now) || now - entry.lastFailureAt >= ACCOUNT_FAILURE_RETENTION_MS) {
		entry = { failCount: 0, lockedUntil: null, lastFailureAt: now };
	}
	entry.failCount++;
	entry.lastFailureAt = now;
	if (entry.failCount >= ACCOUNT_LOCKOUT_MAX_FAILURES && !entry.lockedUntil) {
		entry.lockedUntil = now + ACCOUNT_LOCKOUT_DURATION_MS;
	}
	lockoutStore.set(key, entry);
	return { locked: !!entry.lockedUntil, lockedUntil: entry.lockedUntil, failCount: entry.failCount };
}

/**
 * Clear lockout on successful login.
 */
export function clearLoginFailure(username: string): void {
	lockoutStore.delete(username.toLowerCase());
}

/**
 * Check if an account is currently locked.
 */
export function isAccountLocked(username: string): { locked: boolean; lockedUntil: number | null } {
	const key = username.toLowerCase();
	const entry = lockoutStore.get(key);
	if (!entry || !entry.lockedUntil) return { locked: false, lockedUntil: null };
	if (entry.lockedUntil < Date.now()) {
		lockoutStore.delete(key);
		return { locked: false, lockedUntil: null };
	}
	return { locked: true, lockedUntil: entry.lockedUntil };
}
