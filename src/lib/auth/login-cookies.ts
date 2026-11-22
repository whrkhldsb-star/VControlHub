import type { NextResponse } from "next/server";
import { getPending2faCookieName } from "./session";

export function clearPendingLogin(response: NextResponse, secure: boolean) {
  response.cookies.set(getPending2faCookieName(), "", { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 0 });
}
