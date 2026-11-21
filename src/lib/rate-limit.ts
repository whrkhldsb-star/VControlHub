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
import { PEER_ADDRESS_HEADER, peerAddressIsStamped } from "@/lib/http/peer-address";
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
	// maxRequests + 1 newest timestamps decide the verdict and the retry delay below; attempts older than those
	// (a client hammering a limit it already hit) need not be kept, counted or fetched again on every check.
	const timestamps = await getRateLimitStore().addAndGetWindow(identifier, now, config.windowMs, config.maxRequests + 1);

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
 * With no trusted proxy (`TRUSTED_PROXY_HOPS=0`, the app exposed directly) the
 * key is the connection's own address, which the custom server stamps on every
 * request (`src/lib/http/peer-address.ts`). It used to be "unknown" for every
 * request there: one bucket for the whole site, so anyone who spent the login
 * attempts locked everyone else out for the window.
 *
 * Returns "unknown" when no trusted address is present — callers already treat
 * that as a shared bucket, which is safe (conservative), unlike a spoofed one.
 */
export function getClientIp(request: Request): string {
	const hops = config.http.trustedProxyHops;
	if (hops <= 0) {
		if (!peerAddressIsStamped()) return "unknown";
		return normalizeClientIp(request.headers.get(PEER_ADDRESS_HEADER) ?? "") ?? "unknown";
	}

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
	// Match the trimmed, case-sensitive username used by authenticateUser.
	return username.trim().slice(0, 64);
}

function clientLockoutKey(username: string, clientIp: string | null | undefined) {
	return `${lockoutKey(username)}@${(clientIp?.trim() || "unknown").toLowerCase()}`;
}

async function readLock(key: string) {
	const lockedUntil = (await getRateLimitStore().getLockout(key))?.lockedUntil ?? null;
	return { locked: lockedUntil !== null, lockedUntil };
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

/**
 * Credentials presented outside a sign-in, such as WebDAV's API tokens. Each request costs a token lookup,
 * and the request limit is kept per path so a mounted drive is not throttled while it crawls; a caller that
 * keeps presenting tokens that do not exist could rotate paths for a fresh budget of lookups. Such a client
 * is refused for a while, counted per client address across every path. Without a trusted address
 * ("unknown") nothing is counted: one shared counter would let anyone lock everyone out.
 */
const UNKNOWN_CREDENTIAL_MAX_FAILURES = 60;
const UNKNOWN_CREDENTIAL_LOCK_MS = 5 * 60 * 1000;

function credentialClientKey(scope: string, clientIp: string): string | null {
	const address = clientIp.trim().toLowerCase();
	// ":" keeps these apart from login counters: a username cannot contain one.
	return address && address !== "unknown" ? `credential:${scope}@${address}` : null;
}

/** Whether a client is refused for having presented too many unknown credentials. */
export async function isCredentialClientBlockedAsync(scope: string, clientIp: string): Promise<{ blocked: boolean; retryAfterMs: number }> {
	const key = credentialClientKey(scope, clientIp);
	if (!key) return { blocked: false, retryAfterMs: 0 };
	const lock = await readLock(key);
	return { blocked: lock.locked, retryAfterMs: lock.lockedUntil ? Math.max(0, lock.lockedUntil - Date.now()) : 0 };
}

/** Count a credential that does not exist (not one that exists but may not do what was asked). */
export async function recordUnknownCredentialAsync(scope: string, clientIp: string): Promise<void> {
	const key = credentialClientKey(scope, clientIp);
	if (key) await getRateLimitStore().recordFailures(
		[{ key, maxFailures: UNKNOWN_CREDENTIAL_MAX_FAILURES }], UNKNOWN_CREDENTIAL_LOCK_MS, ACCOUNT_FAILURE_RETENTION_MS,
	);
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
	const states = await getRateLimitStore().recordFailures([
		{ key: clientLockoutKey(username, clientIp), maxFailures: policy.clientFailures },
		{ key: lockoutKey(username), maxFailures: policy.accountFailures },
	], policy.lockoutMs, ACCOUNT_FAILURE_RETENTION_MS);
	const client = states[0]!;
	const account = states[1]!;
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
	await getRateLimitStore().deleteLockouts([lockoutKey(username), clientLockoutKey(username, clientIp)]);
}
