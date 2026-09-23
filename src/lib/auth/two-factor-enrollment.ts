/**
 * TOTP enrollment ticket.
 *
 * Why this exists: `POST /api/auth/2fa/enable` used to take the seed straight
 * from the request body. Anything that could reach that endpoint with a session
 * could therefore enable 2FA against a seed of its own choosing — a stolen
 * session could bind the account to an authenticator the real owner does not
 * have. Verifying a code against that same attacker-supplied seed proves
 * nothing: whoever picked the seed can compute a matching code.
 *
 * So the seed no longer travels as plain input. `POST /api/auth/2fa/setup`
 * generates it, hands back a signed ticket that binds it to that user for a few
 * minutes, and `enable` accepts only the ticket. The seed still reaches the
 * browser (it has to — the user scans it), but the browser can no longer choose
 * which seed gets persisted.
 *
 * The ticket is self-contained (HMAC over the payload) on purpose: a pending
 * enrollment needs no column of its own, so this closes the hole without a
 * schema migration.
 */
import { createHmac, randomBytes } from "node:crypto";

import { getSessionSigningSecret } from "./session";
import { decodeBase64Url, signHmacToken, verifyHmacTokenSignature } from "./hmac-token";

const ENROLLMENT_AUDIENCE = "2fa-enrollment";

/**
 * Long enough to scan a QR and read a code off an authenticator, short enough
 * that a ticket captured from a response body is not a lasting capability.
 */
const ENROLLMENT_TTL_MS = 10 * 60 * 1000;

type EnrollmentPayload = {
  aud: typeof ENROLLMENT_AUDIENCE;
  userId: string;
  secret: string;
  nonce: string;
  iat: number;
  exp: number;
};

/**
 * Derive a distinct key from the session secret. Sharing the raw session key
 * across audiences would let a token minted for one purpose be replayed at
 * another verifier that happens to accept the same shape.
 */
function enrollmentKey() {
  return createHmac("sha256", getSessionSigningSecret())
    .update(ENROLLMENT_AUDIENCE)
    .digest();
}

/** Mint a ticket binding a freshly generated seed to the user setting it up. */
export function createTwoFactorEnrollmentToken(input: {
  userId: string;
  secret: string;
  now?: number;
}): string {
  const now = input.now ?? Date.now();
  const payload: EnrollmentPayload = {
    aud: ENROLLMENT_AUDIENCE,
    userId: input.userId,
    secret: input.secret,
    nonce: randomBytes(16).toString("base64url"),
    iat: now,
    exp: now + ENROLLMENT_TTL_MS,
  };
  return signHmacToken(payload, enrollmentKey());
}

/**
 * Recover the seed from a ticket, or null when the ticket is forged, expired,
 * or was minted for a different account. Returning null (never throwing) keeps
 * every failure on the same "invalid enrollment" branch at the call site.
 */
export function openTwoFactorEnrollmentToken(
  token: string,
  input: { userId: string; now?: number },
): string | null {
  try {
    const [encoded, providedSignature] = token.split(".");
    if (!encoded || !providedSignature) return null;
    if (!verifyHmacTokenSignature(encoded, providedSignature, enrollmentKey())) return null;

    const payload = JSON.parse(decodeBase64Url(encoded)) as EnrollmentPayload;
    if (payload.aud !== ENROLLMENT_AUDIENCE) return null;
    // A ticket minted for another account must not enroll this one, even with a
    // valid signature — otherwise one user could seed another user's 2FA.
    if (payload.userId !== input.userId) return null;
    if (payload.exp <= (input.now ?? Date.now())) return null;
    if (typeof payload.secret !== "string" || payload.secret.length === 0) return null;

    return payload.secret;
  } catch {
    return null;
  }
}
