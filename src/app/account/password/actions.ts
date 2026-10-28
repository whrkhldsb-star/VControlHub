"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { ZodError } from "zod";

import { config } from "@/lib/config/env";
import { requireSession } from "@/lib/auth/require-session";
import {
  createSessionToken,
  getConfiguredSessionTtlSeconds,
  getSessionCookieName,
  sessionTokenExpiresAt,
} from "@/lib/auth/session";
import { changePassword } from "@/lib/auth/service";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { getErrorMessage } from "@/lib/http/error-message";
import { isRequestHttps } from "@/lib/http/request-https";
import { checkRateLimitAsync } from "@/lib/rate-limit";

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

  // Every attempt checks the current password, so an open session (a stolen cookie, an unattended
  // browser) must not be able to guess it here without limit — nor to saturate the bcrypt pool.
  const attempts = await checkRateLimitAsync(`password-change:${session.userId}`, { maxRequests: 5, windowMs: 15 * 60 * 1000 });
  if (!attempts.allowed) {
    return { error: tr("accountPasswordPage.action.tooManyAttempts") } satisfies AccountPasswordActionState;
  }

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
    // Same sign-in, same lifetime: minting with the default TTL cut a 30-day "remember me" session
    // to 7 days (the 2FA changes already keep the original expiry).
    const cookieStore = await cookies();
    const expiresAt = sessionTokenExpiresAt(cookieStore.get(getSessionCookieName())?.value);
    const ttlSeconds = expiresAt
      ? Math.max(1, Math.min(Math.ceil((expiresAt - Date.now()) / 1000), await getConfiguredSessionTtlSeconds(true)))
      : await getConfiguredSessionTtlSeconds(false);
    const refreshedToken = await createSessionToken({
      userId: session.userId,
      username: session.username,
      roles: session.roles,
      // changePassword clears this flag; carry the post-change value, not the
      // pre-change one, or a forced-reset user would be sent back to this page.
      mustChangePassword: false,
      currentTeamId: session.currentTeamId,
    }, { credentialBinding: result.credentialBinding, expiresAt });
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
    if (error instanceof ZodError) {
      // Input validation: say what is wrong in the user's language, not the validator's JSON.
      const mismatch = error.issues.some((issue) => issue.path.includes("confirmPassword"));
      return {
        error: tr(mismatch ? "accountPasswordPage.action.mismatch" : "accountPasswordPage.action.invalidInput"),
      } satisfies AccountPasswordActionState;
    }
    return {
      error: getErrorMessage(error, tr("accountPasswordPage.action.errorFallback")),
    } satisfies AccountPasswordActionState;
  }
}
