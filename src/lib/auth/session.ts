import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

import { createLogger } from "@/lib/logging";
import { getAppSlug } from "@/lib/branding";
import type { RoleKey } from "./rbac";

const logger = createLogger("auth:session");

const APP_SLUG = getAppSlug();
const SESSION_COOKIE_NAME = process.env.AUTH_SESSION_COOKIE_NAME?.trim() || `${APP_SLUG}_session`;
const SESSION_ISSUER = process.env.AUTH_SESSION_ISSUER?.trim() || APP_SLUG;
const SESSION_AUDIENCE = process.env.AUTH_SESSION_AUDIENCE?.trim() || `${APP_SLUG}-console`;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AUTH_BYPASS_PREFIXES = ["/_next", "/api/public", "/api/status", "/favicon.ico"];
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

export async function createSessionToken(payload: SessionPayload) {
  const now = Date.now();
  const envelope: SessionTokenEnvelope = {
    ...payload,
    iss: SESSION_ISSUER,
    aud: SESSION_AUDIENCE,
    iat: now,
    exp: now + SESSION_TTL_MS,
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

 return {
 userId: payload.userId,
 username: payload.username,
 roles: payload.roles,
 mustChangePassword: payload.mustChangePassword,
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
