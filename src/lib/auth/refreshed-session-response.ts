/**
 * Re-mint the caller's session cookie after a security-posture change.
 *
 * 2FA changes retire every session atomically with the credential mutation.
 * Refresh this browser only against the state installed by that mutation;
 * another revocation between the write and this response must still win.
 */
import { NextResponse } from "next/server";

import {
  createSessionToken,
  getConfiguredSessionTtlSeconds,
  getSessionCookieName,
  sessionTokenExpiresAt,
  type SessionPayload,
  type SessionCredentialBinding,
} from "@/lib/auth/session";
import { isRequestHttps } from "@/lib/http/request-https";

export async function refreshedSessionResponse(
  session: SessionPayload,
  request: Request,
  body: Record<string, unknown>,
  credentialBinding: SessionCredentialBinding,
): Promise<NextResponse> {
  // Same sign-in, same lifetime: re-minting with the default TTL cut a
  // 30-day "remember me" session to 7 days on every 2FA change.
  const expiresAt = sessionTokenExpiresAt(readCookie(request, getSessionCookieName()));
  const refreshedToken = await createSessionToken({
    userId: session.userId,
    username: session.username,
    roles: session.roles,
    mustChangePassword: session.mustChangePassword,
    currentTeamId: session.currentTeamId,
  }, { credentialBinding, expiresAt });
  const response = NextResponse.json(body);
  response.cookies.set(getSessionCookieName(), refreshedToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isRequestHttps(request),
    path: "/",
    maxAge: expiresAt
      ? Math.max(1, Math.min(Math.ceil((expiresAt - Date.now()) / 1000), await getConfiguredSessionTtlSeconds(true)))
      : await getConfiguredSessionTtlSeconds(false),
  });
  return response;
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return null; }
    }
  }
  return null;
}
