import { getSetting } from "@/lib/settings/service";
import { t } from "@/lib/i18n/service-translations";

export type PasswordPolicy = {
  minLength: number;
  requireUppercase: boolean;
  requireNumber: boolean;
  requireSpecial: boolean;
};

const SPECIAL_CHARS = /[!@#$%^&*()_\-+=\[\]{};:'",.<>/?\\|`~]/;

/**
 * Load the configured password policy from platform settings.
 *
 * These settings (password.minLength / requireUppercase / requireNumber /
 * requireSpecial) are surfaced in the admin settings UI; this loader is what
 * makes them actually take effect during password change / user creation.
 */
export async function loadPasswordPolicy(): Promise<PasswordPolicy> {
  const [minLengthRaw, requireUppercase, requireNumber, requireSpecial] =
    await Promise.all([
      getSetting("password.minLength"),
      getSetting("password.requireUppercase"),
      getSetting("password.requireNumber"),
      getSetting("password.requireSpecial"),
    ]);

  const parsedMin = Number.parseInt(minLengthRaw, 10);
  const minLength = Number.isFinite(parsedMin) && parsedMin > 0 ? parsedMin : 8;

  return {
    minLength,
    requireUppercase: requireUppercase === "true",
    requireNumber: requireNumber === "true",
    requireSpecial: requireSpecial === "true",
  };
}

export type PasswordPolicyViolation = {
  key: "backend.password.minLength" | "backend.password.uppercase" | "backend.password.digit" | "backend.password.special";
  vars?: Record<string, number>;
};

/**
 * Validate a candidate password against a policy.
 * Returns the first violation as a translation key (plus its variables), or
 * null when the password satisfies the policy (A1-02: the message is rendered
 * in the caller's language, not in hard-coded English).
 */
export function checkPasswordAgainstPolicy(
  password: string,
  policy: PasswordPolicy,
): PasswordPolicyViolation | null {
  if (password.length < policy.minLength) {
    return { key: "backend.password.minLength", vars: { min: policy.minLength } };
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    return { key: "backend.password.uppercase" };
  }
  if (policy.requireNumber && !/[0-9]/.test(password)) {
    return { key: "backend.password.digit" };
  }
  if (policy.requireSpecial && !SPECIAL_CHARS.test(password)) {
    return { key: "backend.password.special" };
  }
  return null;
}

/** The violation in the request's language (zh outside a request). */
export function describePasswordPolicyViolation(violation: PasswordPolicyViolation): string {
  return t(violation.key, violation.vars);
}

/**
 * Load the active policy and validate a password against it.
 * Returns the first violation message, or null when valid.
 */
export async function validatePasswordPolicy(
  password: string,
): Promise<string | null> {
  const policy = await loadPasswordPolicy();
  const violation = checkPasswordAgainstPolicy(password, policy);
  return violation ? describePasswordPolicyViolation(violation) : null;
}
