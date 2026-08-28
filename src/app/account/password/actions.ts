"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { config } from "@/lib/config/env";
import { requireSession } from "@/lib/auth/require-session";
import {
  createSessionToken,
  getConfiguredSessionTtlSeconds,
  getSessionCookieName,
} from "@/lib/auth/session";
import { changePassword, skipPasswordChange } from "@/lib/auth/service";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { getErrorMessage } from "@/lib/http/error-message";
import { isRequestHttps } from "@/lib/http/request-https";

export type AccountPasswordActionState = {
  error?: string;
  success?: string;
};

export async function changePasswordAction(
  _prevState: AccountPasswordActionState | null,
  formData: FormData,
) {
  const session = await requireSession("/account/password");
  const locale = await getServerLocale();
  const tr = (key: string, vars?: Record<string, string | number>) => t(key, locale, vars);

  try {
    const result = await changePassword({
      userId: session.userId,
      currentPassword: String(formData.get("currentPassword") ?? ""),
      newPassword: String(formData.get("newPassword") ?? ""),
      confirmPassword: String(formData.get("confirmPassword") ?? ""),
    });

    if (!result.success) {
      return {
        error: result.error ?? tr("accountPasswordPage.action.errorFallback"),
      } satisfies AccountPasswordActionState;
    }

    // Session cookies are bound to the password they were minted against, so the
    // change just invalidated every session of this account — including the one
    // making this request. That is the point for the *other* sessions, but the
    // user who typed their own new password must not be kicked to /login, so mint
    // a replacement cookie for this session against the new credential.
    const ttlSeconds = await getConfiguredSessionTtlSeconds(false);
    const refreshedToken = await createSessionToken({
      userId: session.userId,
      username: session.username,
      roles: session.roles,
      // changePassword clears this flag; carry the post-change value, not the
      // pre-change one, or a forced-reset user would be sent back to this page.
      mustChangePassword: false,
      currentTeamId: session.currentTeamId,
    });
    // Same Secure decision the login route makes. Server actions have no Request
    // object, so hand isRequestHttps the incoming headers plus the configured
    // public origin — that keeps proxy handling (x-forwarded-proto) in one place
    // instead of a weaker inline copy.
    const headerList = await headers();
    const forwardedProto = headerList.get("x-forwarded-proto");
    const cookieSecure = isRequestHttps(
      new Request(config.app.baseUrl ?? "http://localhost", {
        headers: forwardedProto ? { "x-forwarded-proto": forwardedProto } : {},
      }),
    );
    const cookieStore = await cookies();
    cookieStore.set(getSessionCookieName(), refreshedToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecure,
      path: "/",
      maxAge: ttlSeconds,
    });

    revalidatePath("/");
    revalidatePath("/account/password");

    return {
      success: tr("accountPasswordPage.action.success"),
    } satisfies AccountPasswordActionState;
  } catch (error) {
    return {
      error: getErrorMessage(error, tr("accountPasswordPage.action.errorFallback")),
    } satisfies AccountPasswordActionState;
  }
}

export async function skipPasswordChangeAction(formData: FormData) {
  const session = await requireSession("/account/password");
  if (session.mustChangePassword) {
    await skipPasswordChange(session.userId);
  }

  revalidatePath("/");
  revalidatePath("/account/password");

  const requestedNext = String(formData.get("next") ?? "");
  const safeNext =
    requestedNext.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : "/";
  redirect(safeNext);
}
