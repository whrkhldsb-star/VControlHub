/**
 * TR-042: 系统配置导入服务 — RBAC 域导入模块。
 *
 * 包含权限、角色、角色权限、用户、用户角色的导入逻辑。
 * 从 import-executors.ts 按域拆分而来。
 */

import { Prisma } from "@prisma/client";

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
): Promise<void> {
  if (!options.importUsers) {
    counts.skipped += t.users.length;
    return;
  }
  await upsertByIdWithSecondaryUnique(t.users, options, counts, {
    listExistingIds: async (ids) =>
      new Set(
        (await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((e) => e.id),
      ),
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
            status: (r.passwordHash ? r.status : "PENDING_PASSWORD_RESET") as never,
            mustChangePassword: r.passwordHash ? r.mustChangePassword : true,
            twoFactorEnabled: r.twoFactorEnabled,
            twoFactorSecret: r.twoFactorSecret,
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
      await tx.user.update({
        where: { id: r.id },
        data: {
          username: r.username,
          displayName: r.displayName,
          // In full mode, restore password hash; otherwise keep existing
          ...(r.passwordHash ? { passwordHash: r.passwordHash } : {}),
          status: r.status as never,
          mustChangePassword: r.mustChangePassword,
          twoFactorEnabled: r.twoFactorEnabled,
          // In full mode, restore 2FA secret; otherwise keep existing
          ...(r.twoFactorSecret !== null ? { twoFactorSecret: r.twoFactorSecret } : {}),
          // Mirror createMany: restore UI prefs / locale / layout on overwrite
          ...(r.preferences !== undefined
            ? { preferences: r.preferences as Prisma.InputJsonValue }
            : {}),
        },
      });
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
    select: { id: true },
  });
  const validRoles = await tx.role.findMany({
    where: { id: { in: createRoleIds } },
    select: { id: true },
  });
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
