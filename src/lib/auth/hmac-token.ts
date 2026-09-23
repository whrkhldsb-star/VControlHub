/**
 * Shared HMAC-SHA256 token primitives (TR: one copy, three former duplicates).
 *
 * `base64url(JSON.stringify(payload))` + `.` + HMAC-SHA256 signature is the
 * wire format of every self-signed token in this app: session cookies
 * (session.ts), the SSH WebSocket handshake token (ssh-ws-token.ts) and the
 * 2FA enrollment ticket (two-factor-enrollment.ts). Each file used to carry
 * verbatim copies of encode/decode/sign/compare; they now import from here.
 *
 * This module is deliberately primitive-level: it knows nothing about iss/aud/
 * exp semantics or error surfaces. Callers keep building their own envelope,
 * choosing their own key (the session secret, a per-request secret, or a key
 * derived from the session secret) and mapping verification failure onto their
 * own error type. That keeps the byte format of every existing token — and
 * therefore every outstanding session — unchanged.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Key material accepted by createHmac (string, Buffer, KeyObject, ...). */
type HmacKey = Parameters<typeof createHmac>[1];

export function encodeBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

export function decodeBase64Url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

/** HMAC-SHA256 over `payload` with `secret`, base64url-encoded digest. */
export function hmacSign(payload: string, secret: HmacKey): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Timing-safe string comparison. Length mismatch short-circuits to false
 * (timingSafeEqual throws on unequal lengths, so it must be guarded).
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Mint a `payload.signature` token: the payload is JSON-stringified and
 * base64url-encoded, the signature is `hmacSign` over exactly that encoded
 * payload. Deterministic for the same (payload, secret) pair.
 */
export function signHmacToken(payload: unknown, secret: HmacKey): string {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${hmacSign(encodedPayload, secret)}`;
}

/**
 * True when `signature` is the correct HMAC of `encodedPayload` under
 * `secret`. Constant-time on the comparison; false for wrong-length
 * signatures without throwing.
 */
export function verifyHmacTokenSignature(encodedPayload: string, signature: string, secret: HmacKey): boolean {
  return timingSafeEqualString(signature, hmacSign(encodedPayload, secret));
}
