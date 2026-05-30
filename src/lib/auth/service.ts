import { prisma } from "@/lib/db";

import { writeAuditLog } from "@/lib/audit/service";
import { hashPassword, verifyPassword } from "./password";
import { changePasswordSchema, loginSchema, type ChangePasswordInput, type LoginInput } from "./schema";
import { DEFAULT_ROLE_PERMISSIONS, type Permission, type RoleKey } from "./rbac";
import { normalizeUserPreferences, type UserPreferences } from "@/lib/preferences/user-preferences";

export type AuthenticatedUser = {
 id: string;
 username: string;
 displayName: string | null;
 mustChangePassword: boolean;
 twoFactorEnabled: boolean;
 twoFactorSecret: string | null;
 status: string;
 roles: RoleKey[];
 permissions: Permission[];
 preferences: UserPreferences;
};

export type ChangePasswordResult = {
 success: boolean;
 error?: string;
};

function deriveRoleKeys(keys: string[]): RoleKey[] {
 return keys.filter((key): key is RoleKey => key in DEFAULT_ROLE_PERMISSIONS);
}

function collectPermissions(roleKeys: RoleKey[]): Permission[] {
 return Array.from(
 new Set(roleKeys.flatMap((roleKey) => DEFAULT_ROLE_PERMISSIONS[roleKey])),
 );
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
 twoFactorSecret: user.twoFactorSecret,
 status: user.status,
 roles: roleKeys,
 permissions: collectPermissions(roleKeys),
 preferences: normalizeUserPreferences(user.preferences),
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
    return { success: false, error: "用户不存在" };
  }

  const passwordMatches = await verifyPassword(payload.currentPassword, user.passwordHash);
  if (!passwordMatches) {
    return { success: false, error: "当前密码错误" };
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

	writeAuditLog({
		actorType: "USER",
		actorId: input.userId,
		action: "auth.password_change",
		severity: "INFO",
		detail: { userId: input.userId },
 }).catch(() => {}); // audit failure must not block or pollute production logs

	return { success: true };
}
