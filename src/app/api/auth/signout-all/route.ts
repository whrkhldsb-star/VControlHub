import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiSession } from "@/lib/auth/api-session";
import { bumpUserSessionEpoch, getPending2faCookieName, getSessionCookieName } from "@/lib/auth/session";
import { getCsrfCookieName } from "@/lib/auth/csrf";
import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { isRequestHttps } from "@/lib/http/request-https";
import { getClientIp } from "@/lib/rate-limit";

/**
 * POST /api/auth/signout-all — sign out of EVERY device for this account.
 *
 * Sessions are stateless signed cookies, so plain signout only clears this
 * browser; a cookie that leaked earlier keeps working until its TTL (up to 30
 * days for "remember me"). Advancing the account's session epoch revokes all
 * of them at once: every token was minted against the old epoch and stops
 * verifying on its next request.
 *
 * CSRF applies (not in the proxy exemption list), so the caller must be the
 * authenticated account itself via csrfFetch().
 */
const signoutAllBodySchema = z.undefined();

export async function POST(request: Request) {
  return withApiRoute(
    request,
    { requireAuth: true, bodySchema: signoutAllBodySchema, rateLimit: GENERAL_WRITE_LIMIT },
    async () => {
      const session = await getApiSession();
      if (!session?.userId) {
        return NextResponse.json({ success: false }, { status: 401 });
      }

      await bumpUserSessionEpoch(session.userId);
      await auditUserAction(
        session.userId,
        "auth.signout_all",
        { username: session.username ?? null, ip: getClientIp(request) },
        "WARNING",
        session.currentTeamId,
      );

      // Clear this browser's cookies too (same attributes as /api/auth/signout)
      // so the acting device lands on the login screen instead of riding its
      // now-invalid token into a 401 on the next navigation.
      const response = NextResponse.json({ success: true });
      const cookieSecure = isRequestHttps(request);
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
