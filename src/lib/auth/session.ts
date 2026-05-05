import { createHmac, timingSafeEqual } from "node:crypto";

import type { RoleKey } from "./rbac";

const SESSION_COOKIE_NAME = "whrkhldsb_session";
const SESSION_ISSUER = "whrkhldsb";
const SESSION_AUDIENCE = "whrkhldsb-console";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AUTH_BYPASS_PREFIXES = ["/_next", "/api/public", "/favicon.ico"];
const AUTH_BYPASS_EXACT = new Set(["/login", "/api/login"]);

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
		console.warn("[auth] WARNING: Using default session secret — set AUTH_SESSION_SECRET for production!");
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
