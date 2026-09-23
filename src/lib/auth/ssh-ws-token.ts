import { createHmac, randomBytes } from "node:crypto";

import { decodeBase64Url, signHmacToken, timingSafeEqualString, verifyHmacTokenSignature } from "./hmac-token";

const SSH_WS_HANDSHAKE_AUDIENCE = "ssh-ws-handshake";
const DEFAULT_TTL_MS = 60_000;

type SshWsHandshakePayload = {
  aud: typeof SSH_WS_HANDSHAKE_AUDIENCE;
  userId: string;
  serverId: string;
  origin: string;
  sessionHash: string;
  nonce: string;
  iat: number;
  exp: number;
};

type CreateSshWsHandshakeTokenInput = {
  userId: string;
  serverId: string;
  origin: string;
  sessionId: string;
  secret: string;
  now?: number;
  ttlMs?: number;
};

type VerifySshWsHandshakeTokenInput = {
  serverId: string;
  origin: string;
  sessionId: string;
  secret: string;
  now?: number;
};

function hashSession(sessionId: string, secret: string) {
  return createHmac("sha256", secret).update(sessionId).digest("base64url");
}

function normalizeOrigin(origin: string) {
  return origin.trim().toLowerCase();
}

export function createSshWsHandshakeToken(input: CreateSshWsHandshakeTokenInput) {
  const now = input.now ?? Date.now();
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  const payload: SshWsHandshakePayload = {
    aud: SSH_WS_HANDSHAKE_AUDIENCE,
    userId: input.userId,
    serverId: input.serverId,
    origin: normalizeOrigin(input.origin),
    sessionHash: hashSession(input.sessionId, input.secret),
    nonce: randomBytes(16).toString("base64url"),
    iat: now,
    exp: now + ttlMs,
  };
  return signHmacToken(payload, input.secret);
}

export function verifySshWsHandshakeToken(token: string, input: VerifySshWsHandshakeTokenInput) {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [encodedPayload, providedSignature] = parts;
    if (!encodedPayload || !providedSignature) return null;

    if (!verifyHmacTokenSignature(encodedPayload, providedSignature, input.secret)) return null;

    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as SshWsHandshakePayload;
    if (payload.aud !== SSH_WS_HANDSHAKE_AUDIENCE) return null;
    if (payload.exp <= (input.now ?? Date.now())) return null;
    if (payload.serverId !== input.serverId) return null;
    if (payload.origin !== normalizeOrigin(input.origin)) return null;
    if (!timingSafeEqualString(payload.sessionHash, hashSession(input.sessionId, input.secret))) return null;

    return {
      userId: payload.userId,
      serverId: payload.serverId,
      origin: payload.origin,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
}
