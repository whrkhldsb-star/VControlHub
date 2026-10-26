import { createLogger } from "@/lib/logging";

/**
 * Cloudflare Turnstile on the login form. On when both keys are set in
 * Settings → security policy; TURNSTILE_DISABLED=true in the environment turns
 * it off without the database (a key typo would otherwise keep every
 * administrator, the one who could fix it included, out of the console).
 */
const logger = createLogger("turnstile");

export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js";
/** The hidden form field the widget fills in. */
export const TURNSTILE_RESPONSE_FIELD = "cf-turnstile-response";
const VERIFY_TIMEOUT_MS = 10_000;

export type TurnstileConfig = { siteKey: string; secretKey: string };

export async function getTurnstileConfig(): Promise<TurnstileConfig | null> {
  if (process.env.TURNSTILE_DISABLED === "true") return null;
  const { getSetting } = await import("@/lib/settings/service");
  const [siteKey, secretKey] = await Promise.all([
    getSetting("security.turnstileSiteKey").catch(() => ""),
    getSetting("security.turnstileSecretKey").catch(() => ""),
  ]);
  return siteKey.trim() && secretKey.trim() ? { siteKey: siteKey.trim(), secretKey: secretKey.trim() } : null;
}

type SiteverifyResult = { success?: boolean; "error-codes"?: string[] };

async function siteverify(secret: string, response: string, remoteIp?: string): Promise<SiteverifyResult> {
  const body = new URLSearchParams({ secret, response });
  if (remoteIp) body.set("remoteip", remoteIp);
  const reply = await fetch(TURNSTILE_SITEVERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) });
  if (!reply.ok) throw new Error(`siteverify HTTP ${reply.status}`);
  return (await reply.json()) as SiteverifyResult;
}

export type TurnstileVerdict = { ok: true; unverified?: boolean } | { ok: false; reason: string };

/**
 * Cloudflare's verdict on a widget token. A token Cloudflare rejects (or none)
 * refuses the login; Cloudflare out of reach lets it through to the password
 * and lockout checks, logged: an outage there must not lock everyone out.
 */
export async function verifyTurnstileToken(config: TurnstileConfig, token: unknown, remoteIp?: string): Promise<TurnstileVerdict> {
  if (typeof token !== "string" || !token.trim()) return { ok: false, reason: "missing-input-response" };
  let result: SiteverifyResult;
  try {
    result = await siteverify(config.secretKey, token.trim().slice(0, 2048), remoteIp);
  } catch (error) {
    logger.warn("Turnstile verification unreachable; login continues with password checks only", { error: error instanceof Error ? error.message : String(error) });
    return { ok: true, unverified: true };
  }
  if (result.success === true) return { ok: true };
  return { ok: false, reason: (result["error-codes"] ?? []).join(",") || "rejected" };
}

/**
 * Whether Cloudflare knows this secret: asked with a token that cannot be
 * valid, a good secret answers "invalid-input-response", a wrong one
 * "invalid-input-secret". Null when it is fine or Cloudflare cannot be reached.
 */
export async function checkTurnstileSecret(secret: string): Promise<"invalid-secret" | null> {
  try {
    const result = await siteverify(secret, "vcontrolhub-secret-check");
    return result["error-codes"]?.includes("invalid-input-secret") ? "invalid-secret" : null;
  } catch {
    return null;
  }
}
