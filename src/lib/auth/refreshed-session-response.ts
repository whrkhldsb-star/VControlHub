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
  getSessionCookieName,
  verifiedSessionExpiresAt,
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
  const expiresAt = verifiedSessionExpiresAt(session);
  const cookie = { httpOnly: true, sameSite: "lax" as const, secure: isRequestHttps(request), path: "/" };
  const signedOut = () => {
    const response = NextResponse.json({ ...body, requiresLogin: true });
    response.cookies.set(getSessionCookieName(), "", { ...cookie, maxAge: 0 });
    return response;
  };
  if (!expiresAt || expiresAt <= Date.now()) return signedOut();
  const refreshedToken = await createSessionToken(session, { credentialBinding, expiresAt });
  if (expiresAt <= Date.now()) return signedOut();
  const response = NextResponse.json(body);
  response.cookies.set(getSessionCookieName(), refreshedToken, { ...cookie, expires: new Date(expiresAt) });
  return response;
}
