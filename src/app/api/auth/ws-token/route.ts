import { apiCopy } from "@/lib/i18n/api-copy";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createSshWsHandshakeToken } from "@/lib/auth/ssh-ws-token";
import { getSessionCookieName } from "@/lib/auth/session";
import { config } from "@/lib/config/env";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

import { assertServerTeamAccess } from "@/lib/server/team-access";
const HANDSHAKE_TTL_MS = 60_000;

const requestSchema = z.object({
  serverId: z.string().min(1),
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
  return withApiRoute(
    request,
    {
      permission: "server:ssh",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: requestSchema,
    },
    async ({ session, body }) => {
      // Multi-tenant: never mint a handshake for a server outside the caller's team.
      const teamAccess = await assertServerTeamAccess(session, body.serverId);
      if (!teamAccess.ok) return teamAccess.response;

      const secret = config.ssh.wsSecret;
      if (!secret) {
        return NextResponse.json(
          { error: apiCopy("apiCopy.ssh.ws.secret.not.configured.588c1536") },
          { status: 503 },
        );
      }

      // Bind the handshake to the HttpOnly session cookie value so the WS proxy
      // can authenticate via Cookie without putting the JWT in the query string.
      // Only the cookie is accepted: a caller-supplied session id would let the
      // handshake be bound to a session other than the one being authenticated.
      const sessionId = request.cookies.get(getSessionCookieName())?.value;
      if (!sessionId) {
        return NextResponse.json({ error: apiCopy("apiCopy.missing.session.01c10f66") }, { status: 401 });
      }

      const token = createSshWsHandshakeToken({
        userId: session.userId,
        serverId: body.serverId,
        origin: resolveRequestOrigin(request),
        sessionId,
        secret,
        ttlMs: HANDSHAKE_TTL_MS,
      });

      return NextResponse.json({ token, expiresIn: HANDSHAKE_TTL_MS / 1000 });
    },
  );
}
