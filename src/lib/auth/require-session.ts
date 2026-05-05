import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getSessionCookieName, verifySessionToken, type SessionPayload } from "@/lib/auth/session";

export async function requireSession(nextPath = "/"): Promise<SessionPayload> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(getSessionCookieName());

  if (!sessionCookie?.value) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  try {
    return await verifySessionToken(sessionCookie.value);
  } catch {
    cookieStore.delete(getSessionCookieName());
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
}
