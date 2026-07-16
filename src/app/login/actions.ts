"use server";

import { getServerLocale, t } from "@/lib/i18n/translations";

export type LoginActionState = {
  error?: string;
};

/**
 * Intentionally disabled session-issuing path.
 *
 * The live login surface is POST /api/login (see login-form.tsx action="/api/login"),
 * which enforces rate limits, account lockout, 2FA pending tokens, CSRF rotation,
 * and Secure cookies behind the reverse proxy.
 *
 * This server action used to create a full session cookie without those controls
 * (and without a 2FA gate). Keep the export for historical imports/tests, but
 * never mint credentials here.
 */
export async function login(_prevState: LoginActionState | null, _formData: FormData) {
  const locale = await getServerLocale();
  return {
    error: t("login.error.system", locale),
  } satisfies LoginActionState;
}
