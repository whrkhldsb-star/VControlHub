/**
 * Rate limiting helpers.
 *
 * `checkRateLimitAsync` is the one to use: it delegates to the shared rate-limit
 * store, so it limits across instances when REDIS_URL is configured.
 *
 * There is deliberately no synchronous in-memory variant any more: its counters
 * were per process, so N app instances allowed N× the configured budget. All
 * callers use the shared store.
 */

import { config } from "@/lib/config/env";
import { getRateLimitStore } from "@/lib/rate-limit-store";

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

export async function checkRateLimitAsync(
	identifier: string,
	config: RateLimitConfig = DEFAULT_CONFIG,
): Promise<{ allowed: boolean; retryAfterMs: number; remaining: number }> {
	const now = Date.now();
	const timestamps = await getRateLimitStore().addAndGetWindow(identifier, now, config.windowMs);

	if (timestamps.length > config.maxRequests) {
		// Rejected attempts also occupy the shared window. Leave room for the
		// next request itself, not just for the oldest timestamp to expire.
		const expiresForNextRequest = timestamps[timestamps.length - config.maxRequests] ?? now;
		const retryAfterMs = expiresForNextRequest + config.windowMs - now;
		return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 0), remaining: 0 };
	}

	return { allowed: true, retryAfterMs: 0, remaining: Math.max(config.maxRequests - timestamps.length, 0) };
}

/**
 * Extract the client IP for rate-limit buckets and audit records.
 *
 * Forwarded headers are only trusted when the deployment declares how many
 * proxies sit in front of the app (`TRUSTED_PROXY_HOPS`, default 1 for the
 * shipped Caddy reverse_proxy). Reading the *leftmost* X-Forwarded-For entry
 * (the historical behaviour) is spoofable: a reverse proxy appends the peer
 * address, so the leftmost entry is whatever the client chose to send, letting
 * one attacker rotate a fresh rate-limit bucket per request and disable every
 * IP-scoped limit (share-link password throttling, login throttling) while
 * poisoning audit IPs. Walk `hops` entries from the right instead.
 *
 * Returns "unknown" when no trusted header is present — callers already treat
 * that as a shared bucket, which is safe (conservative), unlike a spoofed one.
 */
export function getClientIp(request: Request): string {
	const hops = config.http.trustedProxyHops;
	if (hops <= 0) return "unknown";

	if (config.http.trustCloudflareHeader) {
		const cfIp = normalizeClientIp(request.headers.get("cf-connecting-ip") ?? "");
		if (cfIp) return cfIp;
	}

	const forwardedFor = request.headers.get("x-forwarded-for");
	if (forwardedFor) {
		const entries = forwardedFor
			.split(",")
			.map((entry) => normalizeClientIp(entry))
			.filter((entry): entry is string => entry !== null);
		// Rightmost entry is contributed by the nearest trusted proxy.
		const candidate = entries[entries.length - hops];
		if (candidate) return candidate;
	}
	return "unknown";
}

/**
 * Trim, strip a trailing port and bound the length. The value lands in
 * rate-limit store keys and audit rows, so an attacker-supplied header must not
 * be able to inject unbounded or multi-line data.
 */
function normalizeClientIp(raw: string): string | null {
	let candidate = raw.trim();
	if (!candidate) return null;
	if (candidate.startsWith("[")) {
		// "[2001:db8::1]:443" → "2001:db8::1"
		const close = candidate.indexOf("]");
		if (close > 0) candidate = candidate.slice(1, close);
	} else if (candidate.split(":").length === 2) {
		// "203.0.113.10:54321" → "203.0.113.10"
		candidate = candidate.slice(0, candidate.lastIndexOf(":"));
	}
	candidate = candidate.trim();
	if (!candidate || candidate.length > 64 || /[\r\n\s]/.test(candidate)) return null;
	return candidate;
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
// Backed by the shared RateLimitStore (Redis when REDIS_URL is set) so multi-
// instance deploys share lockout counters. All production callers use the
// async variants below.

type LockoutEntry = {
	failCount: number;
	lockedUntil: number | null; // timestamp, null = not locked
	lastFailureAt: number;
};

/**
 * Two counters per account. The client counter (username + source address)
 * locks that address after a few misses, so a stranger who knows a username
 * cannot lock its owner out. The account-wide counter is much larger and only
 * exists to bound distributed guessing across many addresses; when it trips
 * the account is locked for everyone and the audit log says so.
 */
const ACCOUNT_LOCKOUT_MAX_FAILURES = 5; // per client address
const ACCOUNT_WIDE_LOCKOUT_MAX_FAILURES = 25; // across every address
const ACCOUNT_LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const ACCOUNT_FAILURE_RETENTION_MS = 15 * 60 * 1000;

export type LockoutScope = "client" | "account";

function lockoutKey(username: string) {
	// The account lookup trims the name, so " admin" and "admin" are one account and must
	// share one failure counter (a counter per spelling made the lockout trivially avoidable).
	// NFKC folds look-alike forms into the same bucket; the length bound keeps a hostile
	// multi-megabyte "username" from being stored as a map key.
	return username.trim().normalize("NFKC").toLowerCase().slice(0, 64);
}

function clientLockoutKey(username: string, clientIp: string | null | undefined) {
	return `${lockoutKey(username)}@${(clientIp?.trim() || "unknown").toLowerCase()}`;
}

function lockoutTtlMs(entry: LockoutEntry, now: number) {
	const until = entry.lockedUntil ?? entry.lastFailureAt + ACCOUNT_FAILURE_RETENTION_MS;
	return Math.max(1_000, until - now + 1_000);
}

function applyLoginFailure(
	entry: LockoutEntry | null,
	now: number,
	maxFailures = ACCOUNT_LOCKOUT_MAX_FAILURES,
	lockoutMs = ACCOUNT_LOCKOUT_DURATION_MS,
): LockoutEntry {
	let next = entry;
	if (
		!next ||
		(next.lockedUntil && next.lockedUntil < now) ||
		now - next.lastFailureAt >= Math.max(lockoutMs, ACCOUNT_FAILURE_RETENTION_MS)
	) {
		next = { failCount: 0, lockedUntil: null, lastFailureAt: now };
	}
	next = {
		failCount: next.failCount + 1,
		lockedUntil: next.lockedUntil,
		lastFailureAt: now,
	};
	if (next.failCount >= maxFailures && !next.lockedUntil) {
		next.lockedUntil = now + lockoutMs;
	}
	return next;
}

async function readLock(key: string): Promise<{ locked: boolean; lockedUntil: number | null }> {
	const store = getRateLimitStore();
	const entry = await store.getLockout(key);
	if (!entry || !entry.lockedUntil) return { locked: false, lockedUntil: null };
	if (entry.lockedUntil < Date.now()) {
		// Delete through the per-key chain so a concurrent
		// recordLoginFailureAsync that rewrote the entry between our get and
		// delete cannot be wiped out by this stale expiry cleanup; re-check
		// inside the chain and only delete what is still an expired lock.
		await chainLockoutMutation(key, async () => {
			const current = await store.getLockout(key);
			if (current?.lockedUntil && current.lockedUntil < Date.now()) {
				await store.deleteLockout(key);
			}
		});
		return { locked: false, lockedUntil: null };
	}
	return { locked: true, lockedUntil: entry.lockedUntil };
}

/**
 * Shared-store lockout check (Redis when configured). Locked when either this
 * client's counter or the account-wide counter has tripped.
 */
export async function isAccountLockedAsync(
	username: string,
	clientIp?: string | null,
): Promise<{ locked: boolean; lockedUntil: number | null; scope: LockoutScope | null }> {
	const [account, client] = await Promise.all([
		readLock(lockoutKey(username)),
		readLock(clientLockoutKey(username, clientIp)),
	]);
	if (account.locked) return { ...account, scope: "account" };
	if (client.locked) return { ...client, scope: "client" };
	return { locked: false, lockedUntil: null, scope: null };
}

/**
 * Per-key mutation chain: concurrent failed logins for the same username must
 * not interleave their read-modify-write (two parallel misses both reading
 * failCount=4 and both writing 5 lose an increment, letting an attacker
 * exceed the 5-attempt threshold). Serializing mutations per key inside the
 * process closes the single-instance race completely and narrows the
 * multi-instance (Redis) window to cross-instance concurrency only.
 */
const lockoutMutations = new Map<string, Promise<unknown>>();

/**
 * Queue `run` behind any in-flight mutation for the same key.
 *
 * The map entry is dropped as soon as its own operation settles, so the map
 * only ever holds in-flight keys and is self-bounding. Without that cleanup
 * every username that ever failed a login would leave a permanent entry — an
 * attacker spraying distinct usernames could grow it without bound.
 * The guard `get(key) === operation` keeps a queued successor's chain intact:
 * it only removes the entry when nothing newer has replaced it yet.
 */
function chainLockoutMutation<T>(key: string, run: () => Promise<T>): Promise<T> {
	const previous = lockoutMutations.get(key) ?? Promise.resolve();
	const operation = previous.catch(() => undefined).then(run);
	lockoutMutations.set(key, operation);
	const drop = () => {
		if (lockoutMutations.get(key) === operation) lockoutMutations.delete(key);
	};
	operation.then(drop, drop);
	return operation;
}

/**
 * Lockout thresholds from the settings (database, then env, then the
 * constants above). Imported lazily so this module stays free of database
 * imports for the request paths that only need `getClientIp`.
 */
async function loginLockoutPolicy(): Promise<{ clientFailures: number; accountFailures: number; lockoutMs: number }> {
	try {
		const { getRuntimeSettingNumbers } = await import("@/lib/runtime-settings/service");
		const values = await getRuntimeSettingNumbers([
			"security.loginLockoutClientFailures",
			"security.loginLockoutAccountFailures",
			"security.loginLockoutMinutes",
		]);
		return {
			clientFailures: values["security.loginLockoutClientFailures"],
			accountFailures: values["security.loginLockoutAccountFailures"],
			lockoutMs: values["security.loginLockoutMinutes"] * 60 * 1000,
		};
	} catch {
		return {
			clientFailures: ACCOUNT_LOCKOUT_MAX_FAILURES,
			accountFailures: ACCOUNT_WIDE_LOCKOUT_MAX_FAILURES,
			lockoutMs: ACCOUNT_LOCKOUT_DURATION_MS,
		};
	}
}

async function recordFailure(key: string, maxFailures: number, lockoutMs: number) {
	return chainLockoutMutation(key, async () => {
		const now = Date.now();
		const store = getRateLimitStore();
		const previousEntry = await store.getLockout(key);
		const entry = applyLoginFailure(previousEntry, now, maxFailures, lockoutMs);
		await store.setLockout(key, entry, lockoutTtlMs(entry, now));
		return entry;
	});
}

/**
 * Record a failed login against the shared store: the client counter and the
 * account-wide counter both advance. `failCount` is the client's count (what
 * the user sees), `accountFailCount` the total across addresses.
 */
export async function recordLoginFailureAsync(
	username: string,
	clientIp?: string | null,
): Promise<{ locked: boolean; lockedUntil: number | null; scope: LockoutScope | null; failCount: number; accountFailCount: number }> {
	const policy = await loginLockoutPolicy();
	const client = await recordFailure(clientLockoutKey(username, clientIp), policy.clientFailures, policy.lockoutMs);
	const account = await recordFailure(lockoutKey(username), policy.accountFailures, policy.lockoutMs);
	const scope: LockoutScope | null = account.lockedUntil ? "account" : client.lockedUntil ? "client" : null;
	return {
		locked: scope !== null,
		lockedUntil: account.lockedUntil ?? client.lockedUntil,
		scope,
		failCount: client.failCount,
		accountFailCount: account.failCount,
	};
}

/**
 * Clear lockout on the shared store after a successful login.
 */
export async function clearLoginFailureAsync(username: string, clientIp?: string | null): Promise<void> {
	for (const key of [lockoutKey(username), clientLockoutKey(username, clientIp)]) {
		await chainLockoutMutation(key, async () => {
			await getRateLimitStore().deleteLockout(key);
		});
	}
}
