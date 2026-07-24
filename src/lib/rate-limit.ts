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
// Prefer the shared RateLimitStore (Redis when REDIS_URL is set) so multi-
// instance deploys share lockout counters. Sync helpers remain for unit
// tests / single-process callers and use the same store when the store is
// the in-memory backend; for Redis they are best-effort process-local only
// — production login uses the async variants.

type LockoutEntry = {
	failCount: number;
	lockedUntil: number | null; // timestamp, null = not locked
	lastFailureAt: number;
};

const ACCOUNT_LOCKOUT_MAX_FAILURES = 5; // lock after N consecutive failures
const ACCOUNT_LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const ACCOUNT_FAILURE_RETENTION_MS = 15 * 60 * 1000;

const lockoutStore = new Map<string, LockoutEntry>();

function lockoutKey(username: string) {
	return username.toLowerCase();
}

function lockoutTtlMs(entry: LockoutEntry, now: number) {
	const until = entry.lockedUntil ?? entry.lastFailureAt + ACCOUNT_FAILURE_RETENTION_MS;
	return Math.max(1_000, until - now + 1_000);
}

function applyLoginFailure(entry: LockoutEntry | null, now: number): LockoutEntry {
	let next = entry;
	if (
		!next ||
		(next.lockedUntil && next.lockedUntil < now) ||
		now - next.lastFailureAt >= ACCOUNT_FAILURE_RETENTION_MS
	) {
		next = { failCount: 0, lockedUntil: null, lastFailureAt: now };
	}
	next = {
		failCount: next.failCount + 1,
		lockedUntil: next.lockedUntil,
		lastFailureAt: now,
	};
	if (next.failCount >= ACCOUNT_LOCKOUT_MAX_FAILURES && !next.lockedUntil) {
		next.lockedUntil = now + ACCOUNT_LOCKOUT_DURATION_MS;
	}
	return next;
}

// Clean up stale lockout entries every 10 minutes (process-local cache only)
setInterval(() => {
	const now = Date.now();
	for (const [key, entry] of lockoutStore) {
		if ((entry.lockedUntil && entry.lockedUntil < now) || now - entry.lastFailureAt >= ACCOUNT_FAILURE_RETENTION_MS) {
			lockoutStore.delete(key);
		}
	}
}, 10 * 60 * 1000);

/**
 * Record a failed login attempt for a username (process-local).
 * Prefer `recordLoginFailureAsync` in multi-instance production paths.
 */
export function recordLoginFailure(username: string): { locked: boolean; lockedUntil: number | null; failCount: number } {
	const key = lockoutKey(username);
	const now = Date.now();
	const entry = applyLoginFailure(lockoutStore.get(key) ?? null, now);
	lockoutStore.set(key, entry);
	return { locked: !!entry.lockedUntil, lockedUntil: entry.lockedUntil, failCount: entry.failCount };
}

/**
 * Clear lockout on successful login (process-local).
 */
export function clearLoginFailure(username: string): void {
	lockoutStore.delete(lockoutKey(username));
}

/**
 * Check if an account is currently locked (process-local).
 */
export function isAccountLocked(username: string): { locked: boolean; lockedUntil: number | null } {
	const key = lockoutKey(username);
	const entry = lockoutStore.get(key);
	if (!entry || !entry.lockedUntil) return { locked: false, lockedUntil: null };
	if (entry.lockedUntil < Date.now()) {
		lockoutStore.delete(key);
		return { locked: false, lockedUntil: null };
	}
	return { locked: true, lockedUntil: entry.lockedUntil };
}

/**
 * Shared-store lockout check (Redis when configured).
 */
export async function isAccountLockedAsync(
	username: string,
): Promise<{ locked: boolean; lockedUntil: number | null }> {
	const key = lockoutKey(username);
	const store = getRateLimitStore();
	const entry = await store.getLockout(key);
	if (!entry || !entry.lockedUntil) return { locked: false, lockedUntil: null };
	if (entry.lockedUntil < Date.now()) {
		await store.deleteLockout(key);
		lockoutStore.delete(key);
		return { locked: false, lockedUntil: null };
	}
	// Keep process cache warm for sync callers in the same worker.
	lockoutStore.set(key, entry);
	return { locked: true, lockedUntil: entry.lockedUntil };
}

/**
 * Record a failed login against the shared store.
 */
export async function recordLoginFailureAsync(
	username: string,
): Promise<{ locked: boolean; lockedUntil: number | null; failCount: number }> {
	const key = lockoutKey(username);
	const now = Date.now();
	const store = getRateLimitStore();
	const previous = await store.getLockout(key);
	const entry = applyLoginFailure(previous, now);
	await store.setLockout(key, entry, lockoutTtlMs(entry, now));
	lockoutStore.set(key, entry);
	return { locked: !!entry.lockedUntil, lockedUntil: entry.lockedUntil, failCount: entry.failCount };
}

/**
 * Clear lockout on the shared store after a successful login.
 */
export async function clearLoginFailureAsync(username: string): Promise<void> {
	const key = lockoutKey(username);
	await getRateLimitStore().deleteLockout(key);
	lockoutStore.delete(key);
}
