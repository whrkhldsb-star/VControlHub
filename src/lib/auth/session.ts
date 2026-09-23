import { apiCopy } from "@/lib/i18n/api-copy";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

import { createLogger } from "@/lib/logging";
import { getAppSlug } from "@/lib/branding";
import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { AuthError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import type { Permission, RoleKey } from "./rbac";
import { DEFAULT_ROLE_PERMISSIONS } from "./rbac";
import { resolveEffectivePermissions } from "./effective-permissions";

const logger = createLogger("auth:session");

const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const REMEMBER_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function readPositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getSessionTtlSeconds(remember = false) {
  const fallback = remember ? REMEMBER_SESSION_TTL_SECONDS : DEFAULT_SESSION_TTL_SECONDS;
  const envName = remember ? "AUTH_REMEMBER_SESSION_TTL_SECONDS" : "AUTH_SESSION_TTL_SECONDS";
  return readPositiveIntEnv(envName, fallback);
}

/**
 * Resolve the effective session TTL honouring (in priority order):
 *   1. The env override (AUTH_SESSION_TTL_SECONDS / AUTH_REMEMBER_SESSION_TTL_SECONDS).
 *   2. For non-remember sessions, the admin-configurable `session.timeout` setting.
 *   3. The hardcoded fallback.
 *
 * This is what makes the "会话超时（秒）" setting in the admin UI actually
 * govern how long a normal login stays valid.
 */
export async function getConfiguredSessionTtlSeconds(remember = false): Promise<number> {
  const envName = remember ? "AUTH_REMEMBER_SESSION_TTL_SECONDS" : "AUTH_SESSION_TTL_SECONDS";
  const envOverride = process.env[envName]?.trim();
  if (envOverride) {
    return getSessionTtlSeconds(remember);
  }
  // "Remember me" sessions keep their long fixed TTL; the configurable
  // timeout only applies to standard logins.
  if (!remember) {
    try {
      const { getSetting } = await import("@/lib/settings/service");
      const raw = await getSetting("session.timeout");
      const parsed = Number(raw);
      if (Number.isInteger(parsed) && parsed > 0) {
        return parsed;
      }
    } catch (error) {
      logger.warn("Failed to read session.timeout setting, using default session duration", error);
    }
  }
  return getSessionTtlSeconds(remember);
}


export type SessionPayload = {
  userId: string;
  username: string;
  roles: RoleKey[];
  mustChangePassword: boolean;
  currentTeamId: string | null;
  /**
   * Effective permissions of the session. Resolved from the database on every
   * cookie-session verification (base roles ∪ the user's direct grants, see
   * `effective-permissions.ts`) and from the token's grant list for API-token
   * sessions. Never serialised into the session cookie: a revoked grant must
   * stop working on the next request, not when the cookie expires.
   */
  permissions?: Permission[];
};

type SessionTokenEnvelope = SessionPayload & {
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  /**
   * Fingerprint of the credential this session was minted against. See
   * {@link credentialFingerprint} — this is what makes a password change
   * invalidate every other session of that account.
   */
  cfp?: string;
  /**
   * Session-revocation epoch (`User.sessionEpoch`) at mint time. Advancing the
   * column (2FA enable/disable, "sign out everywhere") invalidates every token
   * carrying an older epoch. Missing on pre-epoch tokens and read as 0, which
   * matches the column default, so the upgrade does not force a mass re-login.
   */
  sep?: number;
};

/**
 * The raw HMAC key behind every session-scoped token. Exported so sibling
 * token helpers (e.g. two-factor-enrollment) derive their own audience key from
 * the same root instead of introducing a second secret to configure.
 */
export function getSessionSigningSecret(): string {
	return getSessionSecret();
}

function getSessionSecret() {
	const secret = config.auth.sessionSecret;
	if (!secret) {
		if (config.isProduction) {
			throw new Error("AUTH_SESSION_SECRET must be set in production. Set it in .env.local");
		}
		logger.warn("using default development session secret; set AUTH_SESSION_SECRET for production");
		return "dev-only-session-secret-change-me";
	}
	return secret;
}

function encodeBase64Url(input: string) {
  return Buffer.from(input).toString("base64url");
}

function decodeBase64Url(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signPayload(payload: string) {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

/**
 * Bind a session to the password it was issued against.
 *
 * Sessions are stateless cookies, so changing a password used to leave every
 * previously-issued cookie working until its own expiry — up to 30 days for a
 * "remember me" login. That is the wrong behaviour for the single most common
 * reason people change a password: they believe someone else has their old one.
 *
 * The fingerprint is an HMAC of the stored password hash, so a password change
 * (which rewrites `passwordHash`) changes it and every cookie carrying the old
 * value stops verifying. It is an HMAC rather than the hash itself so a leaked
 * cookie never carries anything derived from the credential in the clear, and it
 * is truncated because it only has to detect change, not resist preimage.
 *
 * Deliberately derived, not stored: this needs no column and no migration, and
 * `verifySessionToken` already reads the user row on every request, so checking
 * it costs one more selected field and no extra query.
 */
function credentialFingerprint(passwordHash: string): string {
  return createHmac("sha256", getSessionSecret())
    .update(`session-credential:${passwordHash}`)
    .digest("base64url")
    .slice(0, 22);
}

export function getSessionCookieName() {
  return config.auth.sessionCookieName || `${getAppSlug()}_session`;
}

/**
 * Advance the account's session-revocation epoch. Every session token minted
 * against an older epoch stops verifying on its next request — the "sign out
 * everywhere" primitive, and the hook 2FA enable/disable uses so a cookie
 * stolen before 2FA cannot outlive the upgrade.
 */
export async function bumpUserSessionEpoch(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { sessionEpoch: { increment: 1 } },
  });
}

function getSessionIdentity() {
  const appSlug = getAppSlug();
  const issuer = config.auth.sessionIssuer || appSlug;
  const audience = config.auth.sessionAudience || `${appSlug}-console`;
  return { issuer, audience };
}

export async function createSessionToken(payload: SessionPayload, options: { remember?: boolean } = {}) {
  const now = Date.now();
  const ttlMs = (await getConfiguredSessionTtlSeconds(options.remember === true)) * 1000;
  const { issuer, audience } = getSessionIdentity();
  // Read here rather than taking it as a parameter so every existing call site
  // keeps working unchanged. This runs once per login, not per request.
  const credentialOwner = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { passwordHash: true, sessionEpoch: true },
  });
  const envelope: SessionTokenEnvelope = {
    ...payload,
    iss: issuer,
    aud: audience,
    iat: now,
    exp: now + ttlMs,
    ...(credentialOwner ? { cfp: credentialFingerprint(credentialOwner.passwordHash) } : {}),
    sep: credentialOwner?.sessionEpoch ?? 0,
  };

  const encodedPayload = encodeBase64Url(JSON.stringify(envelope));
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function verifySessionToken(token: string) {
  const [encodedPayload, providedSignature] = token.split(".");

  if (!encodedPayload || !providedSignature) {
    throw new AuthError(apiCopy("apiCopy.invalid.session.token.format.ab35c21d"));
  }

  const expectedSignature = signPayload(encodedPayload);
  const providedBuffer = Buffer.from(providedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (providedBuffer.length !== expectedBuffer.length) {
    throw new AuthError(apiCopy("apiCopy.invalid.session.token.signature.6f87b99a"));
  }

  const signaturesMatch = timingSafeEqual(providedBuffer, expectedBuffer);
  if (!signaturesMatch) {
    throw new AuthError(apiCopy("apiCopy.invalid.session.token.signature.6f87b99a"));
  }

  const payload = JSON.parse(decodeBase64Url(encodedPayload)) as SessionTokenEnvelope & {
    pending2fa?: boolean;
  };

  const { issuer, audience } = getSessionIdentity();
  if (payload.iss !== issuer || payload.aud !== audience) {
    throw new AuthError(apiCopy("apiCopy.invalid.session.token.audience.e137b2d8"));
  }

  // Pending-2FA tokens must never authenticate as a full session. They share the
  // same HMAC secret historically; aud split + this flag check block cookie swap.
  if (payload.pending2fa === true) {
    throw new AuthError(apiCopy("apiCopy.pending.2fa.token.is.not.a.session.712ea82f"));
  }

  if (payload.exp <= Date.now()) {
    throw new AuthError(apiCopy("apiCopy.session.token.expired.f1044201"));
  }

 const user = await prisma.user.findUnique({
   where: { id: payload.userId },
   select: {
     id: true,
     username: true,
     status: true,
     mustChangePassword: true,
     sessionEpoch: true,
     // The tenant pointer is resolved through the relation rather than the raw
     // `currentTeamId` column, so the membership check rides along in the same
     // round trip — see where `currentTeamId` is computed below.
     currentTeam: {
       select: {
         id: true,
         members: {
           where: { userId: payload.userId },
           select: { userId: true },
           take: 1,
         },
       },
     },
     passwordHash: true,
     roles: { select: { role: { select: { key: true } } } },
   },
 });

 if (!user || user.status === "DISABLED") {
   throw new AuthError(apiCopy("apiCopy.session.user.is.disabled.or.no.longer.exists.6b046fab"));
 }

 // Reject a session minted against a password that has since been replaced.
 // Fails closed on a missing `cfp`: tokens issued before this check existed
 // carry no fingerprint, and honouring them would keep the hole open for the
 // rest of their TTL. The visible effect is a one-time re-login on upgrade.
 if (payload.cfp !== credentialFingerprint(user.passwordHash)) {
   throw new AuthError(t("backend.auth.sessionCredentialsChanged"));
 }

 // Same fail-closed check for the revocation epoch. Unlike `cfp`, a missing
 // `sep` maps to the column default (0) rather than rejecting: every existing
 // user row starts at 0, so pre-epoch tokens stay valid and the upgrade is
 // invisible. The first `bumpUserSessionEpoch` retires them all at once.
 // (`user.sessionEpoch ?? 0` only smooths partial rows — the column itself
 // is NOT NULL DEFAULT 0 after the migration.)
 if ((payload.sep ?? 0) !== (user.sessionEpoch ?? 0)) {
   throw new AuthError(t("backend.auth.sessionCredentialsChanged"));
 }

 const assignedRoleKeys = user.roles.map((entry) => entry.role.key);
 const roles = assignedRoleKeys.filter(
   (key): key is RoleKey => key in DEFAULT_ROLE_PERMISSIONS,
 );
 // Per-user grants live outside the static role map, so they have to be read
 // here — otherwise every guard silently falls back to role-only permissions.
 const permissions = await resolveEffectivePermissions({
   userId: user.id,
   roles,
   assignedRoleKeys,
 });

 // `currentTeamId` is the entire tenant scope — `teamWhere()` honours it on
 // every query — and it is read fresh from the database here rather than
 // carried in the token, so a row that outlives its membership keeps granting
 // access. Honour the pointer only while the membership backing it still
 // exists: a removed member, or a workspace tombstoned by `deleteTeam` (which
 // drops every membership), then falls back to no team instead of retaining
 // the old one. Both writers clear the column themselves; this is the
 // fail-closed backstop for a stale row they missed.
 const currentTeamId =
   user.currentTeam && user.currentTeam.members.length > 0
     ? user.currentTeam.id
     : null;

 return {
 userId: user.id,
 username: user.username,
 roles,
 permissions,
 mustChangePassword: user.mustChangePassword,
 currentTeamId,
 } satisfies SessionPayload;
}

// ─────────────────────────────────────────────────────────────
// Pending 2FA Token
// ─────────────────────────────────────────────────────────────
// When a user with 2FA enabled passes the password check, we
// create a short-lived "pending 2FA" token instead of a full
// session. This token is stored in a separate cookie and can
// only be exchanged for a real session after TOTP verification.

const PENDING_2FA_TTL_MS = 5 * 60 * 1000; // 5 minutes

export type Pending2faSessionPayload = SessionPayload & {
 remember?: boolean;
};

type Pending2faPayload = Pending2faSessionPayload & {
 pending2fa: true;
 nonce: string;
};

export function getPending2faCookieName() {
	return `${getAppSlug()}_pending_2fa`;
}

export async function createPending2faToken(payload: Pending2faSessionPayload): Promise<string> {
	const now = Date.now();
	const nonce = randomBytes(16).toString("hex");
	const { issuer, audience } = getSessionIdentity();
	const envelope: Pending2faPayload & { iss: string; aud: string; iat: number; exp: number } = {
		...payload,
		pending2fa: true,
		nonce,
		iss: issuer,
		aud: `${audience}-pending-2fa`,
		iat: now,
		exp: now + PENDING_2FA_TTL_MS,
	};
	const encodedPayload = encodeBase64Url(JSON.stringify(envelope));
	const signature = signPayload(encodedPayload);
	return `${encodedPayload}.${signature}`;
}

export async function verifyPending2faToken(token: string): Promise<Pending2faSessionPayload | null> {
	try {
		const [encodedPayload, providedSignature] = token.split(".");
		if (!encodedPayload || !providedSignature) return null;

		const expectedSignature = signPayload(encodedPayload);
		const providedBuffer = Buffer.from(providedSignature, "utf8");
		const expectedBuffer = Buffer.from(expectedSignature, "utf8");

		if (providedBuffer.length !== expectedBuffer.length) return null;
		if (!timingSafeEqual(providedBuffer, expectedBuffer)) return null;

		const payload = JSON.parse(decodeBase64Url(encodedPayload)) as Pending2faPayload & { iss: string; aud: string; iat: number; exp: number };

		const { issuer, audience } = getSessionIdentity();
		if (payload.iss !== issuer || payload.aud !== `${audience}-pending-2fa`) return null;
		if (payload.exp <= Date.now()) return null;
		if (!payload.pending2fa) return null;

		return {
			userId: payload.userId,
			username: payload.username,
			roles: payload.roles,
			mustChangePassword: payload.mustChangePassword,
			currentTeamId: payload.currentTeamId ?? null,
			remember: payload.remember === true,
		};
	} catch {
		return null;
	}
}
