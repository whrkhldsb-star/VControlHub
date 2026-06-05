import { getSetting } from "@/lib/settings/service";

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

/**
 * Validate a candidate password against a policy.
 * Returns a Chinese error message describing the first violation, or null when
 * the password satisfies the policy.
 */
export function checkPasswordAgainstPolicy(
  password: string,
  policy: PasswordPolicy,
): string | null {
  if (password.length < policy.minLength) {
    return `密码长度至少 ${policy.minLength} 位`;
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    return "密码必须包含至少一个大写字母";
  }
  if (policy.requireNumber && !/[0-9]/.test(password)) {
    return "密码必须包含至少一个数字";
  }
  if (policy.requireSpecial && !SPECIAL_CHARS.test(password)) {
    return "密码必须包含至少一个特殊字符";
  }
  return null;
}

/**
 * Load the active policy and validate a password against it.
 * Returns the first violation message, or null when valid.
 */
export async function validatePasswordPolicy(
  password: string,
): Promise<string | null> {
  const policy = await loadPasswordPolicy();
  return checkPasswordAgainstPolicy(password, policy);
}
