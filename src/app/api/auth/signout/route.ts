import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiSession } from "@/lib/auth/api-session";
import { getCsrfCookieName } from "@/lib/auth/csrf";
import { getPending2faCookieName, getSessionCookieName } from "@/lib/auth/session";
import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { isRequestHttps } from "@/lib/http/request-https";
import { getClientIp } from "@/lib/rate-limit";

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
 */
const signoutBodySchema = z.undefined();

export async function POST(request: Request) {
  return withApiRoute(
    request,
    { bodySchema: signoutBodySchema, rateLimit: GENERAL_WRITE_LIMIT },
    async () => {
      // Best-effort: resolve session before cookie clear so logout is auditable.
      const session = await getApiSession();
      if (session?.userId) {
        await auditUserAction(
          session.userId,
          "auth.signout",
          {
            username: session.username ?? null,
            ip: getClientIp(request),
          },
          undefined,
          session.currentTeamId,
        );
      }

      const requestUrl = new URL(request.url);
      const response = NextResponse.redirect(new URL("/login", requestUrl), 303);
      response.headers.set("location", "/login");
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
      response.cookies.set(getPending2faCookieName(), "", {
        httpOnly: true,
        sameSite: "lax",
        secure: cookieSecure,
        path: "/",
        maxAge: 0,
      });
      return response;
    },
  );
}
