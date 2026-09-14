import { redirect } from "next/navigation";

import type { SessionPayload } from "@/lib/auth/session";
import { getCurrentSession } from "@/lib/auth/server-session";

const PASSWORD_CHANGE_PATH = "/account/password";

export async function requireSession(nextPath = "/"): Promise<SessionPayload> {
  // Server Components cannot mutate cookies. Share the request-cached session
  // lookup with the layout/sidebar and let login replace invalid credentials.
  const session = await getCurrentSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  // 强制初始/被重置用户先修改密码，再访问其他受保护页面，避免默认密码长期可用。
  if (session.mustChangePassword && nextPath !== PASSWORD_CHANGE_PATH) {
    redirect(PASSWORD_CHANGE_PATH);
  }

  return session;
}
