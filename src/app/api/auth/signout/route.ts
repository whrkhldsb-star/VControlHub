import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiSession } from "@/lib/auth/api-session";
import { getCsrfCookieName } from "@/lib/auth/csrf";
import { getSessionCookieName } from "@/lib/auth/session";
import { accountSecurityAuditTeam, auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { isRequestHttps } from "@/lib/http/request-https";
import { clearPendingLogin } from "@/lib/auth/login-cookies";
import { createLogger } from "@/lib/logging";
import { getClientIp } from "@/lib/rate-limit";
import { publishSessionSignout } from "@/lib/ws/session-signout";

/**
 * POST /api/auth/signout — clears every auth cookie and redirects.
 * No request body expected; bodySchema enforces empty body.
 *
 * All three cookies login can set are cleared, not just the session:
 *  - the session cookie itself
 *  - `csrf_token`, which login/verify-login set with the session's own maxAge.
 *    Leaving it behind meant a shared browser kept a readable (non-HttpOnly)
 *    token from the previous user for up to the whole session TTL.
 *  - the pending-2FA cookie, so a signout mid-2FA does not leave a 5-minute
 *    ticket that still exchanges for a full session for that account.
 *
 * A verified session cookie is also announced as signed out (see
 * lib/ws/session-signout): its notification socket, remote desktops, terminals
 * and detached keep-alive shells close at once instead of at their next
 * periodic re-check, or, for a detached shell, never. Only this cookie's: the
 * account's other devices stay signed in, so `sessionEpoch` is not advanced.
 */
const logger = createLogger("auth:signout");
const signoutBodySchema = z.undefined();

function requestCookie(request: Request, name: string): string | null {
  const prefix = `${name}=`;
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(prefix)) continue;
    const value = trimmed.slice(prefix.length);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    { bodySchema: signoutBodySchema, rateLimit: GENERAL_WRITE_LIMIT },
    async () => {
      const wantsJson = request.headers.get("accept")?.includes("application/json");
      const response = wantsJson
        ? NextResponse.json({ signedOut: true })
        : new NextResponse(null, { status: 303, headers: { location: "/login" } });
      const cookieSecure = isRequestHttps(request);
      // Attributes must match how each cookie was set, or the browser treats the
      // clear as a different cookie and keeps the original. `csrf_token` is the
      // one exception on httpOnly: login sets it readable for the JS header.
      response.cookies.set(getSessionCookieName(), "", {
        httpOnly: true,
        sameSite: "lax",
        secure: cookieSecure,
        path: "/",
        maxAge: 0,
      });
      response.cookies.set(getCsrfCookieName(), "", {
        httpOnly: false,
        sameSite: "lax",
        secure: cookieSecure,
        path: "/",
        maxAge: 0,
      });
      clearPendingLogin(response, cookieSecure);
      try {
        const session = await getApiSession();
        if (session?.userId) {
          // getApiSession verified this very cookie, so only a real session of this user is announced.
          const token = requestCookie(request, getSessionCookieName())?.trim();
          if (token) {
            try {
              publishSessionSignout(session.userId, token);
            } catch (error) {
              logger.warn("signout socket teardown unavailable", error);
            }
          }
          await auditUserAction(
            session.userId,
            "auth.signout",
            {
              username: session.username ?? null,
              ip: getClientIp(request),
            },
            undefined,
            // A platform administrator's sign-out is a platform event, as their sign-in is (login route): filed under
            // the customer they had selected, it showed their address and times in that customer's audit log.
            accountSecurityAuditTeam(session),
          );
        }
      } catch (error) {
        logger.warn("signout audit unavailable", error);
      }
      return response;
    },
  );
}
