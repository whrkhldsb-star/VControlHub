import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

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

function encodeBase64Url(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function decodeBase64Url(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signPayload(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function hashSession(sessionId: string, secret: string) {
  return createHmac("sha256", secret).update(sessionId).digest("base64url");
}

function normalizeOrigin(origin: string) {
  return origin.trim().toLowerCase();
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
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
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, input.secret);
  return `${encodedPayload}.${signature}`;
}

export function verifySshWsHandshakeToken(token: string, input: VerifySshWsHandshakeTokenInput) {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [encodedPayload, providedSignature] = parts;
    if (!encodedPayload || !providedSignature) return null;

    const expectedSignature = signPayload(encodedPayload, input.secret);
    if (!safeEqual(providedSignature, expectedSignature)) return null;

    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as SshWsHandshakePayload;
    if (payload.aud !== SSH_WS_HANDSHAKE_AUDIENCE) return null;
    if (payload.exp <= (input.now ?? Date.now())) return null;
    if (payload.serverId !== input.serverId) return null;
    if (payload.origin !== normalizeOrigin(input.origin)) return null;
    if (!safeEqual(payload.sessionHash, hashSession(input.sessionId, input.secret))) return null;

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
