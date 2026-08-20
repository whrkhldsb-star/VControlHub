import { prisma } from "@/lib/db";

import { auditUserAction } from "@/lib/audit/service";
import { hashPassword, verifyPassword } from "./password";
import { validatePasswordPolicy } from "./password-policy";
import { changePasswordSchema, loginSchema, type ChangePasswordInput, type LoginInput } from "./schema";
import { DEFAULT_ROLE_PERMISSIONS, getPermissionsFromRoles, type Permission, type RoleKey } from "./rbac";
import { normalizeUserPreferencesForRoles, type UserPreferences } from "@/lib/preferences/user-preferences";

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

export async function skipPasswordChange(userId: string): Promise<void> {
	await prisma.user.update({
		where: { id: userId },
		data: {
			mustChangePassword: false,
			status: "ACTIVE",
		},
	});

	await auditUserAction(
		userId,
		"auth.password_change_skipped",
		{ userId },
		"WARNING",
	);
}

function deriveRoleKeys(keys: string[]): RoleKey[] {
 return keys.filter((key): key is RoleKey => key in DEFAULT_ROLE_PERMISSIONS);
}

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
 return null;
 }

 const passwordMatches = await verifyPassword(payload.password, user.passwordHash);
 if (!passwordMatches || user.status === "DISABLED") {
 return null;
 }

 const roleKeys = deriveRoleKeys(user.roles.map((entry) => entry.role.key));

 return {
 id: user.id,
 username: user.username,
 displayName: user.displayName,
 mustChangePassword: user.mustChangePassword,
 twoFactorEnabled: user.twoFactorEnabled,
 hasTwoFactorSecret: Boolean(user.twoFactorSecret),
 status: user.status,
 roles: roleKeys,
 permissions: getPermissionsFromRoles(roleKeys),
 preferences: normalizeUserPreferencesForRoles(user.preferences, roleKeys),
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

	await auditUserAction(input.userId, "auth.password_change", { userId: input.userId });

	return { success: true };
}
