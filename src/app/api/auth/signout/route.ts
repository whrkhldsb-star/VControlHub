import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionCookieName } from "@/lib/auth/session";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { isRequestHttps } from "@/lib/http/request-https";

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
