import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getSessionCookieName, verifySessionToken, type SessionPayload } from "@/lib/auth/session";

const PASSWORD_CHANGE_PATH = "/account/password";

export async function requireSession(nextPath = "/"): Promise<SessionPayload> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(getSessionCookieName());

  if (!sessionCookie?.value) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  let session: SessionPayload;
  try {
    session = await verifySessionToken(sessionCookie.value);
  } catch {
    cookieStore.delete(getSessionCookieName());
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  // 强制初始/被重置用户先修改密码，再访问其他受保护页面，避免默认密码长期可用。
  if (session.mustChangePassword && nextPath !== PASSWORD_CHANGE_PATH) {
    redirect(PASSWORD_CHANGE_PATH);
  }

  return session;
}
