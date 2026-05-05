import { NextResponse, type NextRequest } from "next/server";

import { getSessionCookieName, shouldBypassAuth, verifySessionToken } from "@/lib/auth/session";

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (shouldBypassAuth(pathname)) {
    return NextResponse.next();
  }

  const session = request.cookies.get(getSessionCookieName())?.value;
  if (session) {
    try {
      await verifySessionToken(session);
      return NextResponse.next();
    } catch {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      const response = NextResponse.redirect(loginUrl);
      response.cookies.delete(getSessionCookieName());
      return response;
    }
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
