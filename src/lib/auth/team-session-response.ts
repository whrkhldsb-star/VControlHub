import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isRequestHttps } from "@/lib/http/request-https";
import { getSessionCookieName, reissueSessionForTeam } from "./session";

/** Rotate this browser's signed cookie after a validated customer change. */
export async function teamSessionResponse(
  request: Request,
  teamId: string | null,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  const cookieName = getSessionCookieName();
  const current = (await cookies()).get(cookieName)?.value;
  // Bearer-token callers (e.g. admin automation) have no browser session cookie
  // to rotate; return the committed JSON payload instead of failing with 401.
  if (!current) return NextResponse.json(body);
  const rotated = await reissueSessionForTeam(current, teamId);
  const response = NextResponse.json(body);
  response.cookies.set(cookieName, rotated.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isRequestHttps(request),
    path: "/",
    maxAge: rotated.maxAge,
  });
  return response;
}
