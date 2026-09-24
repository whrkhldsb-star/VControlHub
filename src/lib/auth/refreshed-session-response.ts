/**
 * Re-mint the caller's session cookie after a security-posture change.
 *
 * 2FA enable/disable retires every session of the account via
 * `bumpUserSessionEpoch` (a downgrade must also kill possibly stolen
 * cookies). The routes then rebuild *this* browser's cookie from the
 * still-valid in-memory session so the operator is not bounced to the
 * login screen by their own action. Both routes used to carry this
 * ~20-line block verbatim.
 */
import { NextResponse } from "next/server";

import {
  createSessionToken,
  getConfiguredSessionTtlSeconds,
  getSessionCookieName,
  type SessionPayload,
} from "@/lib/auth/session";
import { isRequestHttps } from "@/lib/http/request-https";

export async function refreshedSessionResponse(
  session: SessionPayload,
  request: Request,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  const refreshedToken = await createSessionToken({
    userId: session.userId,
    username: session.username,
    roles: session.roles,
    mustChangePassword: session.mustChangePassword,
    currentTeamId: session.currentTeamId,
  });
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
