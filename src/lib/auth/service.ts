import { prisma } from "@/lib/db";

import { auditUserAction } from "@/lib/audit/service";
import { hashPassword, verifyPassword } from "./password";
import { validatePasswordPolicy } from "./password-policy";
import { changePasswordSchema, loginSchema, type ChangePasswordInput, type LoginInput } from "./schema";
import { DEFAULT_ROLE_PERMISSIONS, type Permission, type RoleKey } from "./rbac";
import { normalizeUserPreferencesForSession, type UserPreferences } from "@/lib/preferences/user-preferences";
import { resolveEffectivePermissions } from "./effective-permissions";

export type AuthenticatedUser = {
 id: string;
 username: string;
 displayName: string | null;
 mustChangePassword: boolean;
 twoFactorEnabled: boolean;
 /** True when a sealed TOTP seed is present; secret itself is never returned from authenticateUser. */
 hasTwoFactorSecret: boolean;
 status: string;
 roles: RoleKey[];
 permissions: Permission[];
 preferences: UserPreferences;
 currentTeamId: string | null;
};

export type ChangePasswordResult = {
  success: boolean;
  error?: string;
};

// `skipPasswordChange` was removed deliberately: every writer of
// `mustChangePassword = true` (bootstrap admin, admin-provisioned accounts,
// admin-forced resets) distributes a credential somebody else already knows,
// so the flag must only ever be cleared by the owner setting a new password.

function deriveRoleKeys(keys: string[]): RoleKey[] {
 return keys.filter((key): key is RoleKey => key in DEFAULT_ROLE_PERMISSIONS);
}

/**
 * Fixed cost-12 bcrypt hash of a random placeholder. Compared against when a
 * username does not exist so failed logins take the same time whether or not
 * the account is real. Not a credential: it hashes no secret anyone can use.
 */
const DUMMY_PASSWORD_HASH_FOR_TIMING =
	"$2b$12$iyxLnESNwAUrz8qhz2FYCOwXhUeOv1zwowkGuJsB6xvaXjKuKzGN.";

export async function authenticateUser(input: LoginInput): Promise<AuthenticatedUser | null> {
 const parsed = loginSchema.safeParse(input);
 if (!parsed.success) {
 return null;
 }
 const payload = parsed.data;

 const user = await prisma.user.findUnique({
 where: { username: payload.username },
 include: {
 roles: {
 include: {
 role: true,
 },
 },
 },
 });

 if (!user) {
  // Username-enumeration timing: an existing account costs a full bcrypt
  // compare (SALT_ROUNDS = 12, hundreds of ms) while a missing one returned
  // immediately. Burn the same cost on a fixed dummy hash so the response
  // time cannot be used to probe which usernames exist.
  await verifyPassword(payload.password, DUMMY_PASSWORD_HASH_FOR_TIMING);
  return null;
 }

 const passwordMatches = await verifyPassword(payload.password, user.passwordHash);
 if (!passwordMatches || user.status === "DISABLED") {
 return null;
 }

 const assignedRoleKeys = user.roles.map((entry) => entry.role.key);
 const roleKeys = deriveRoleKeys(assignedRoleKeys);
 // Direct grants are not part of the static role map; resolve them here so the
 // login redirect and the returned permission list match what the guards see.
 const permissions = await resolveEffectivePermissions({
   userId: user.id,
   roles: roleKeys,
   assignedRoleKeys,
 });

 return {
 id: user.id,
 username: user.username,
 displayName: user.displayName,
 mustChangePassword: user.mustChangePassword,
 twoFactorEnabled: user.twoFactorEnabled,
 hasTwoFactorSecret: Boolean(user.twoFactorSecret),
 status: user.status,
 roles: roleKeys,
 permissions,
 preferences: normalizeUserPreferencesForSession(user.preferences, {
   roles: roleKeys,
   permissions,
 }),
 currentTeamId: user.currentTeamId,
 };
}

export async function changePassword(input: ChangePasswordInput & { userId: string }): Promise<ChangePasswordResult> {
  const payload = changePasswordSchema.parse({
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
    confirmPassword: input.confirmPassword ?? input.newPassword,
  });

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      passwordHash: true,
    },
  });

  if (!user) {
    return { success: false, error: "User does not exist" };
  }

  const passwordMatches = await verifyPassword(payload.currentPassword, user.passwordHash);
  if (!passwordMatches) {
    return { success: false, error: "Current password is incorrect" };
  }

  const policyError = await validatePasswordPolicy(payload.newPassword);
  if (policyError) {
    return { success: false, error: policyError };
  }

  const nextPasswordHash = await hashPassword(payload.newPassword);

	await prisma.user.update({
		where: { id: input.userId },
		data: {
			passwordHash: nextPasswordHash,
			mustChangePassword: false,
			status: "ACTIVE",
		},
	});

	// Account-level, deliberately unstamped — see auth.password_change_skipped.
	await auditUserAction(input.userId, "auth.password_change", { userId: input.userId });

	return { success: true };
}
