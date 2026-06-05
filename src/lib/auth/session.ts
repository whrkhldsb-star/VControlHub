import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

import { createLogger } from "@/lib/logging";
import { getAppSlug } from "@/lib/branding";
import { prisma } from "@/lib/db";
import type { RoleKey } from "./rbac";
import { DEFAULT_ROLE_PERMISSIONS } from "./rbac";

const logger = createLogger("auth:session");

const APP_SLUG = getAppSlug();
const SESSION_COOKIE_NAME = process.env.AUTH_SESSION_COOKIE_NAME?.trim() || `${APP_SLUG}_session`;
const SESSION_ISSUER = process.env.AUTH_SESSION_ISSUER?.trim() || APP_SLUG;
const SESSION_AUDIENCE = process.env.AUTH_SESSION_AUDIENCE?.trim() || `${APP_SLUG}-console`;
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
      logger.warn("读取 session.timeout 设置失败，使用默认会话时长", error);
    }
  }
  return getSessionTtlSeconds(remember);
}
const AUTH_BYPASS_PREFIXES = [
  "/_next",
  "/api/public",
  "/api/status",
  "/favicon.ico",
  "/icon.png",
  "/apple-icon.png",
];
const AUTH_BYPASS_EXACT = new Set(["/login", "/login/verify-2fa", "/api/login", "/api/auth/2fa/verify-login", "/status"]);

export type SessionPayload = {
  userId: string;
  username: string;
  roles: RoleKey[];
  mustChangePassword: boolean;
};

type SessionTokenEnvelope = SessionPayload & {
  iss: string;
  aud: string;
  iat: number;
  exp: number;
};

function getSessionSecret() {
	const secret = process.env.AUTH_SESSION_SECRET;
	if (!secret) {
		if (process.env.NODE_ENV === "production") {
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

export function getSessionCookieName() {
  return SESSION_COOKIE_NAME;
}

export function shouldBypassAuth(pathname: string) {
  if (AUTH_BYPASS_EXACT.has(pathname)) {
    return true;
  }

  return AUTH_BYPASS_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function createSessionToken(payload: SessionPayload, options: { remember?: boolean } = {}) {
  const now = Date.now();
  const ttlMs = (await getConfiguredSessionTtlSeconds(options.remember === true)) * 1000;
  const envelope: SessionTokenEnvelope = {
    ...payload,
    iss: SESSION_ISSUER,
    aud: SESSION_AUDIENCE,
    iat: now,
    exp: now + ttlMs,
  };

  const encodedPayload = encodeBase64Url(JSON.stringify(envelope));
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function verifySessionToken(token: string) {
  const [encodedPayload, providedSignature] = token.split(".");

  if (!encodedPayload || !providedSignature) {
    throw new Error("Invalid session token format");
  }

  const expectedSignature = signPayload(encodedPayload);
  const providedBuffer = Buffer.from(providedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (providedBuffer.length !== expectedBuffer.length) {
    throw new Error("Invalid session token signature");
  }

  const signaturesMatch = timingSafeEqual(providedBuffer, expectedBuffer);
  if (!signaturesMatch) {
    throw new Error("Invalid session token signature");
  }

  const payload = JSON.parse(decodeBase64Url(encodedPayload)) as SessionTokenEnvelope;

  if (payload.iss !== SESSION_ISSUER || payload.aud !== SESSION_AUDIENCE) {
    throw new Error("Invalid session token audience");
  }

  if (payload.exp <= Date.now()) {
    throw new Error("Session token expired");
  }

 const user = await prisma.user.findUnique({
   where: { id: payload.userId },
   select: {
     id: true,
     username: true,
     status: true,
     mustChangePassword: true,
     roles: { select: { role: { select: { key: true } } } },
   },
 });

 if (!user || user.status === "DISABLED") {
   throw new Error("Session user is disabled or no longer exists");
 }

 const roles = user.roles
   .map((entry) => entry.role.key)
   .filter((key): key is RoleKey => key in DEFAULT_ROLE_PERMISSIONS);

 return {
 userId: user.id,
 username: user.username,
 roles,
 mustChangePassword: user.mustChangePassword,
 } satisfies SessionPayload;
}

// ─────────────────────────────────────────────────────────────
// Pending 2FA Token
// ─────────────────────────────────────────────────────────────
// When a user with 2FA enabled passes the password check, we
// create a short-lived "pending 2FA" token instead of a full
// session. This token is stored in a separate cookie and can
// only be exchanged for a real session after TOTP verification.

const PENDING_2FA_COOKIE_NAME = `${APP_SLUG}_pending_2fa`;
const PENDING_2FA_TTL_MS = 5 * 60 * 1000; // 5 minutes

type Pending2faPayload = SessionPayload & {
 pending2fa: true;
 nonce: string;
};

export function getPending2faCookieName() {
	return PENDING_2FA_COOKIE_NAME;
}

export async function createPending2faToken(payload: SessionPayload): Promise<string> {
	const now = Date.now();
	const nonce = randomBytes(16).toString("hex");
	const envelope: Pending2faPayload & { iss: string; aud: string; iat: number; exp: number } = {
		...payload,
		pending2fa: true,
		nonce,
		iss: SESSION_ISSUER,
		aud: SESSION_AUDIENCE,
		iat: now,
		exp: now + PENDING_2FA_TTL_MS,
	};
	const encodedPayload = encodeBase64Url(JSON.stringify(envelope));
	const signature = signPayload(encodedPayload);
	return `${encodedPayload}.${signature}`;
}

export async function verifyPending2faToken(token: string): Promise<SessionPayload | null> {
	try {
		const [encodedPayload, providedSignature] = token.split(".");
		if (!encodedPayload || !providedSignature) return null;

		const expectedSignature = signPayload(encodedPayload);
		const providedBuffer = Buffer.from(providedSignature, "utf8");
		const expectedBuffer = Buffer.from(expectedSignature, "utf8");

		if (providedBuffer.length !== expectedBuffer.length) return null;
		if (!timingSafeEqual(providedBuffer, expectedBuffer)) return null;

		const payload = JSON.parse(decodeBase64Url(encodedPayload)) as Pending2faPayload & { iss: string; aud: string; iat: number; exp: number };

		if (payload.iss !== SESSION_ISSUER || payload.aud !== SESSION_AUDIENCE) return null;
		if (payload.exp <= Date.now()) return null;
		if (!payload.pending2fa) return null;

		return {
			userId: payload.userId,
			username: payload.username,
			roles: payload.roles,
			mustChangePassword: payload.mustChangePassword,
		};
	} catch {
		return null;
	}
}
