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
  const refreshedToken = await createSessionToken({
    userId: session.userId,
    username: session.username,
    roles: session.roles,
    mustChangePassword: session.mustChangePassword,
    currentTeamId: session.currentTeamId,
  }, { credentialBinding });
  const response = NextResponse.json(body);
  response.cookies.set(getSessionCookieName(), refreshedToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isRequestHttps(request),
    path: "/",
    maxAge: await getConfiguredSessionTtlSeconds(false),
  });
  return response;
}
