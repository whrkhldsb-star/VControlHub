import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { AuthError } from "@/lib/errors";
import { apiCopy } from "@/lib/i18n/api-copy";
import { isRequestHttps } from "@/lib/http/request-https";
import { getSessionCookieName, reissueSessionForTeam } from "./session";

/** Rotate this browser's signed cookie after a validated workspace change. */
export async function teamSessionResponse(
  request: Request,
  teamId: string | null,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  const cookieName = getSessionCookieName();
  const current = (await cookies()).get(cookieName)?.value;
  if (!current) throw new AuthError(apiCopy("apiCopy.invalid.session.token.format.ab35c21d"));
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
