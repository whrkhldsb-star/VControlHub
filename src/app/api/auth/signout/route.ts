import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiSession } from "@/lib/auth/api-session";
import { getSessionCookieName } from "@/lib/auth/session";
import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { isRequestHttps } from "@/lib/http/request-https";
import { getClientIp } from "@/lib/rate-limit";

/**
 * POST /api/auth/signout — clears the session cookie and redirects.
 * No request body expected; bodySchema enforces empty body.
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
      response.cookies.set(getSessionCookieName(), "", {
        httpOnly: true,
        sameSite: "lax",
        secure: isRequestHttps(request),
        path: "/",
        maxAge: 0,
      });
      return response;
    },
  );
}
