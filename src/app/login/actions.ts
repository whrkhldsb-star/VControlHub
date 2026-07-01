"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { authenticateUser } from "@/lib/auth/service";
import { createSessionToken, getSessionCookieName } from "@/lib/auth/session";
import { config } from "@/lib/config/env";

export type LoginActionState = {
  error?: string;
};

function safeNextPath(nextValue: FormDataEntryValue | null) {
  const next = typeof nextValue === "string" ? nextValue : "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function getPostLoginRedirectPath(nextValue: FormDataEntryValue | null, defaultPage: string) {
  const requestedNextPath = safeNextPath(nextValue);
  return requestedNextPath === "/" ? defaultPage : requestedNextPath;
}

export async function login(_prevState: LoginActionState | null, formData: FormData) {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const requestedNextPath = formData.get("next");

  const user = await authenticateUser({ username, password });
  if (!user) {
    return {
      error: "用户名或密码错误",
    } satisfies LoginActionState;
  }

  const token = await createSessionToken({
    userId: user.id,
    username: user.username,
    roles: user.roles,
    mustChangePassword: user.mustChangePassword,
    currentTeamId: user.currentTeamId,
  });

  const cookieStore = await cookies();
  cookieStore.set(getSessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });

  redirect(getPostLoginRedirectPath(requestedNextPath, user.preferences.defaultPage));
}
