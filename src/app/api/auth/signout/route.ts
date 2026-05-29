import { NextResponse } from "next/server";

import { getSessionCookieName } from "@/lib/auth/session";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export async function POST(request: Request) {
  return withApiRoute(request, { rateLimit: GENERAL_WRITE_LIMIT }, async () => {
    const requestUrl = new URL(request.url);
    const response = NextResponse.redirect(new URL("/login", requestUrl), 303);
    response.headers.set("location", "/login");
    response.cookies.set(getSessionCookieName(), "", {
      httpOnly: true,
      sameSite: "lax",
      secure: requestUrl.protocol === "https:",
      path: "/",
      maxAge: 0,
    });
    return response;
  });
}
