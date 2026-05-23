import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireApiPermission } from "@/lib/auth/require-api-permission";
import { createSshWsHandshakeToken } from "@/lib/auth/ssh-ws-token";

const HANDSHAKE_TTL_MS = 60_000;

const requestSchema = z.object({
  serverId: z.string().min(1),
  sessionToken: z.string().min(1),
});

function resolveRequestOrigin(request: NextRequest) {
  const origin = request.headers.get("origin")?.trim();
  if (origin) return origin;
  return new URL(request.url).origin;
}

/**
 * POST /api/auth/ws-token
 * Returns a short-lived, per-session SSH WebSocket handshake token.
 * Never returns SSH_WS_SECRET to the browser.
 */
export async function POST(request: NextRequest) {
  const result = await requireApiPermission("server:ssh");
  if (result instanceof NextResponse) return result;

  const secret = process.env.SSH_WS_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "SSH_WS_SECRET not configured" }, { status: 503 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid WebSocket token request" }, { status: 400 });
  }

  const token = createSshWsHandshakeToken({
    userId: result.session.userId,
    serverId: parsed.data.serverId,
    origin: resolveRequestOrigin(request),
    sessionId: parsed.data.sessionToken,
    secret,
    ttlMs: HANDSHAKE_TTL_MS,
  });

  return NextResponse.json({ token, expiresIn: HANDSHAKE_TTL_MS / 1000 });
}
