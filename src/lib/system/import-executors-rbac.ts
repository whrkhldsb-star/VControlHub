/**
 * TR-042: 系统配置导入服务 — RBAC 域导入模块。
 *
 * 包含权限、角色、角色权限、用户、用户角色的导入逻辑。
 * 从 import-executors.ts 按域拆分而来。
 */

import { Prisma } from "@prisma/client";

import { ConflictError, ValidationError } from "@/lib/errors";
import { t as translate } from "@/lib/i18n/service-translations";
import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";
import { upsertByIdWithSecondaryUnique } from "./import-executors-helpers";
import { parseDate } from "./import-executors-helpers";
import type { Tx, Counts } from "./import-executors-helpers";

// 1. Permissions
export async function importPermissions(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  await upsertByIdWithSecondaryUnique(t.permissions, options, counts, {
    listExistingIds: async (ids) =>
      new Set(
        (await tx.permission.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((e) => e.id),
      ),
    listTakenSecondaryValues: async (values) =>
      new Set(
        (await tx.permission.findMany({ where: { key: { in: values } }, select: { key: true } })).map((h) => h.key),
      ),
    secondaryValueOf: (r) => r.key,
    createManySkipDuplicates: async (rows) =>
      (
        await tx.permission.createMany({
          data: rows.map((r) => ({
            id: r.id,
            key: r.key,
            name: r.name,
            description: r.description,
          })),
          skipDuplicates: true,
        })
      ).count,
    hasSecondaryClash: async (r) =>
      Boolean(
        await tx.permission.findFirst({
          where: { key: r.key, NOT: { id: r.id } },
          select: { id: true },
        }),
      ),
    updateById: async (r) => {
      await tx.permission.update({
        where: { id: r.id },
        data: { key: r.key, name: r.name, description: r.description },
      });
    },
  });
}

// 2. Roles
export async function importRoles(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  await upsertByIdWithSecondaryUnique(t.roles, options, counts, {
    listExistingIds: async (ids) =>
      new Set(
        (await tx.role.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((e) => e.id),
      ),
    listTakenSecondaryValues: async (values) =>
      new Set(
        (await tx.role.findMany({ where: { key: { in: values } }, select: { key: true } })).map((h) => h.key),
      ),
    secondaryValueOf: (r) => r.key,
    createManySkipDuplicates: async (rows) =>
      (
        await tx.role.createMany({
          data: rows.map((r) => ({
            id: r.id,
            key: r.key,
            name: r.name,
            description: r.description,
          })),
          skipDuplicates: true,
        })
      ).count,
    hasSecondaryClash: async (r) =>
      Boolean(
        await tx.role.findFirst({
          where: { key: r.key, NOT: { id: r.id } },
          select: { id: true },
        }),
      ),
    updateById: async (r) => {
      // Renaming a role also changes every existing assignment, even when this
      // partial package contains no users or membership rows.
      if (r.key === "admin") {
        const customer = await tx.user.findFirst({
          where: { roles: { some: { roleId: r.id } }, teamMembership: { isNot: null } }, select: { id: true },
        });
        if (customer) throw new ValidationError(translate("backend.system.importAccountTypeConflict", { id: customer.id }));
      }
      await tx.role.update({
        where: { id: r.id },
        data: { key: r.key, name: r.name, description: r.description },
      });
    },
  });
}

// 3. RolePermissions (create-only junction table, no try/catch)
export async function importRolePermissions(
  tx: Tx,
  t: ExportFile["tables"],
  _options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.rolePermissions;
  if (records.length === 0) return;
  const roleIds = [...new Set(records.map((r) => r.roleId))];
  const permissionIds = [...new Set(records.map((r) => r.permissionId))];
  const [roles, permissions] = await Promise.all([
    tx.role.findMany({ where: { id: { in: roleIds } }, select: { id: true } }),
    tx.permission.findMany({ where: { id: { in: permissionIds } }, select: { id: true } }),
  ]);
  const validRoleIds = new Set(roles.map((row) => row.id));
  const validPermissionIds = new Set(permissions.map((row) => row.id));
  const validRecords = records.filter(
    (row) => validRoleIds.has(row.roleId) && validPermissionIds.has(row.permissionId),
  );
  counts.skipped += records.length - validRecords.length;
  const result = await tx.rolePermission.createMany({
    data: validRecords.map((r) => ({
      roleId: r.roleId,
      permissionId: r.permissionId,
    })),
    skipDuplicates: true,
  });
  counts.created += result.count;
  counts.skipped += validRecords.length - result.count;
}

// 4. Users (可选，条件性密码处理)
export async function importUsers(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
  exportMode?: ExportFile["exportMode"],
): Promise<void> {
  if (!options.importUsers) {
    counts.skipped += t.users.length;
    return;
  }
  const previous = new Map<string, { status: string; mustChangePassword: boolean }>();
  await upsertByIdWithSecondaryUnique(t.users, options, counts, {
    listExistingIds: async (ids) => {
      const users = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, mustChangePassword: true } });
      for (const user of users) previous.set(user.id, user);
      return new Set(previous.keys());
    },
    listTakenSecondaryValues: async (values) =>
      new Set(
        (await tx.user.findMany({ where: { username: { in: values } }, select: { username: true } })).map(
          (h) => h.username,
        ),
      ),
    secondaryValueOf: (r) => r.username,
    createManySkipDuplicates: async (rows) =>
      (
        await tx.user.createMany({
          data: rows.map((r) => ({
            id: r.id,
            username: r.username,
            displayName: r.displayName,
            // Full mode: restore actual hash; Standard: force password reset
            passwordHash: r.passwordHash ?? "DISABLED_IMPORT_RESET",
            status: (r.passwordHash || r.status === "DISABLED" ? r.status : "PENDING_PASSWORD_RESET") as never,
            mustChangePassword: r.passwordHash ? r.mustChangePassword : true,
            // A standard export leaves the secret out. "Enabled" without a
            // secret is no second factor at all: login skips it, yet the
            // account page shows it on and setup refused to enrol again.
            twoFactorEnabled: r.twoFactorEnabled && Boolean(r.twoFactorSecret),
            twoFactorSecret: r.twoFactorSecret,
            twoFactorRecoveryCodes: (r.twoFactorRecoveryCodes ?? undefined) as Prisma.InputJsonValue | undefined,
            preferences: r.preferences as Prisma.InputJsonValue | undefined,
          })),
          skipDuplicates: true,
        })
      ).count,
    hasSecondaryClash: async (r) =>
      Boolean(
        await tx.user.findFirst({
          where: { username: r.username, NOT: { id: r.id } },
          select: { id: true },
        }),
      ),
    updateById: async (r) => {
      const current = previous.get(r.id)!;
      const restricted = (r.status === "DISABLED" && current.status !== "DISABLED") || (r.mustChangePassword && !current.mustChangePassword);
      await tx.user.update({
        where: { id: r.id },
        data: {
          username: r.username,
          displayName: r.displayName,
          // In full mode, restore password hash; otherwise keep existing
          ...(r.passwordHash ? { passwordHash: r.passwordHash } : {}),
          status: r.status as never,
          mustChangePassword: r.mustChangePassword,
          // Full mode's null means explicitly cleared, not redacted. Old
          // packages without a mode retain their historical null semantics.
          ...(exportMode === "full" || r.twoFactorSecret !== null ? {
            twoFactorEnabled: r.twoFactorEnabled && Boolean(r.twoFactorSecret),
            twoFactorSecret: r.twoFactorEnabled ? r.twoFactorSecret : null,
          } : {}),
          ...(exportMode === "full" || r.twoFactorRecoveryCodes != null ? {
            twoFactorRecoveryCodes: exportMode === "full" && (!r.twoFactorEnabled || !r.twoFactorSecret)
              ? Prisma.DbNull
              : r.twoFactorRecoveryCodes == null ? Prisma.DbNull : r.twoFactorRecoveryCodes as Prisma.InputJsonValue,
          } : {}),
          // Retire sessions atomically for new restrictions and credential restores.
          ...(restricted || r.passwordHash || exportMode === "full" || r.twoFactorSecret !== null || r.twoFactorRecoveryCodes != null
            ? { sessionEpoch: { increment: 1 } } : {}),
          // Mirror createMany: restore UI prefs / locale / layout on overwrite
          ...(r.preferences !== undefined
            ? { preferences: r.preferences as Prisma.InputJsonValue }
            : {}),
        },
      });
      previous.set(r.id, r);
    },
  });
}

// 5. UserRoles (create-only junction table, FK try/catch → pre-filter FK validity)
export async function importUserRoles(
  tx: Tx,
  t: ExportFile["tables"],
  _options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.userRoles;
  if (records.length === 0) return;

  // Batch existence check by composite key
  const userIds = [...new Set(records.map((r) => r.userId))];
  const existing = await tx.userRole.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, roleId: true },
  });
  const existingKeys = new Set(
    existing.map((e) => `${e.userId}:${e.roleId}`),
  );
  const toCreate = records.filter(
    (r) => !existingKeys.has(`${r.userId}:${r.roleId}`),
  );
  counts.skipped += records.length - toCreate.length;

  if (toCreate.length === 0) return;

  // Pre-filter FK validity (userId, roleId) — original used try/catch per record
  const createUserIds = [...new Set(toCreate.map((r) => r.userId))];
  const createRoleIds = [...new Set(toCreate.map((r) => r.roleId))];
  const validUsers = await tx.user.findMany({
    where: { id: { in: createUserIds } },
    select: { id: true, teamMembership: { select: { teamId: true } } },
  });
  const validRoles = await tx.role.findMany({
    where: { id: { in: createRoleIds } },
    select: { id: true, key: true },
  });
  const customerIds = new Set(validUsers.filter((user) => user.teamMembership).map((user) => user.id));
  const adminId = validRoles.find((role) => role.key === "admin")?.id;
  const conflict = toCreate.find((row) => row.roleId === adminId && customerIds.has(row.userId));
  if (conflict) throw new ValidationError(translate("backend.system.importAccountTypeConflict", { id: conflict.userId }));
  const validUserIds = new Set(validUsers.map((u) => u.id));
  const validRoleIds = new Set(validRoles.map((r) => r.id));
  const validToCreate = toCreate.filter(
    (r) => validUserIds.has(r.userId) && validRoleIds.has(r.roleId),
  );
  // FK 不存在 → skip
  counts.skipped += toCreate.length - validToCreate.length;

  if (validToCreate.length > 0) {
    const result = await tx.userRole.createMany({
      data: validToCreate.map((r) => ({
        userId: r.userId,
        roleId: r.roleId,
        assignedAt: parseDate(r.assignedAt, "userRoles.assignedAt"),
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
    counts.skipped += validToCreate.length - result.count;
  }
}

/** A locking read also invalidates a serializable snapshot if the previous
 * administrator-lock holder changed the selected user or role during lock acquisition. */
export async function assertImportHasActiveAdmin(tx: Tx) {
  const admins = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT u.id FROM "User" u
    JOIN "UserRole" ur ON ur."userId" = u.id
    JOIN "Role" r ON r.id = ur."roleId"
    WHERE u.status = 'ACTIVE' AND r.key = 'admin'
      AND NOT EXISTS (SELECT 1 FROM team_members m WHERE m."userId" = u.id)
    LIMIT 1 FOR SHARE OF u, ur, r`;
  if (!admins.length) throw new ConflictError(translate("backend.user.cannotRemoveLastAdmin"));
}
