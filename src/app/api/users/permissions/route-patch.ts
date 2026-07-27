import type { SessionPayload } from "@/lib/auth/session";
import { isGlobalTeamManager, teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { parseNullableBigIntInput } from "@/lib/storage/access-control";

type PermissionPatch = {
  userId: string;
  roleKeys?: string[];
  permissionKeys?: string[];
  storageAccess?: Array<{
    storageNodeId: string;
    pathPrefix?: string;
    canRead?: boolean;
    canWrite?: boolean;
    canDelete?: boolean;
    quotaBytes?: string | number | null;
    maxFileBytes?: string | number | null;
  }>;
};

function normalizePathPrefix(value: unknown) {
  return String(value ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

export async function applyUserPermissionPatch(input: {
  session: SessionPayload;
  parsedData: PermissionPatch;
  targetUsername: string;
  roleKeys: string[] | undefined;
  permissionKeys: string[] | undefined;
  storageAccess: PermissionPatch["storageAccess"] | undefined;
}) {
  const { session, parsedData, targetUsername, roleKeys, permissionKeys, storageAccess } = input;
  await prisma.$transaction(async (tx) => {
    if (roleKeys) {
      const customRoleKey = `user:${parsedData.userId}:custom`;
      const roles = await tx.role.findMany({
        where: { key: { in: roleKeys } },
        select: { id: true, key: true },
        take: roleKeys.length,
      });
      await tx.userRole.deleteMany({
        where: { userId: parsedData.userId, role: { key: { not: customRoleKey } } },
      });
      if (roles.length > 0) {
        await tx.userRole.createMany({
          data: roles.map((role) => ({ userId: parsedData.userId, roleId: role.id })),
          skipDuplicates: true,
        });
      }
    }

    if (permissionKeys) {
      const customRoleKey = `user:${parsedData.userId}:custom`;
      const customRole = await tx.role.upsert({
        where: { key: customRoleKey },
        update: {
          name: `${targetUsername} 's custom permissions`,
          description: "Auto-maintained by user permission config page",
        },
        create: {
          key: customRoleKey,
          name: `${targetUsername} 's custom permissions`,
          description: "Auto-maintained by user permission config page",
        },
      });
      const permissionRows = await tx.permission.findMany({
        where: { key: { in: permissionKeys } },
        select: { id: true },
        take: permissionKeys.length,
      });
      await tx.rolePermission.deleteMany({ where: { roleId: customRole.id } });
      if (permissionRows.length > 0) {
        await tx.rolePermission.createMany({
          data: permissionRows.map((permission) => ({
            roleId: customRole.id,
            permissionId: permission.id,
          })),
          skipDuplicates: true,
        });
      }
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: parsedData.userId, roleId: customRole.id } },
        update: {},
        create: { userId: parsedData.userId, roleId: customRole.id },
      });
    }

    if (storageAccess) {
      const nodeScope = teamWhere(session);
      const validNodeIds = new Set(
        (
          await tx.storageNode.findMany({
            where: nodeScope,
            select: { id: true },
            take: 500,
          })
        ).map((node) => node.id),
      );
      if (isGlobalTeamManager(session)) {
        await tx.userStorageAccess.deleteMany({ where: { userId: parsedData.userId } });
      } else {
        await tx.userStorageAccess.deleteMany({
          where: { userId: parsedData.userId, storageNode: nodeScope },
        });
      }
      const mapped = storageAccess.map((grant) => ({
        userId: parsedData.userId,
        storageNodeId: String(grant.storageNodeId ?? ""),
        pathPrefix: normalizePathPrefix(grant.pathPrefix),
        canRead: grant.canRead ?? true,
        canWrite: grant.canWrite ?? false,
        canDelete: grant.canDelete ?? false,
        quotaBytes: parseNullableBigIntInput(grant.quotaBytes),
        maxFileBytes: parseNullableBigIntInput(grant.maxFileBytes),
      }));
      const outOfTeam = mapped
        .map((grant) => grant.storageNodeId)
        .filter((id) => id && !validNodeIds.has(id));
      if (outOfTeam.length > 0) {
        throw new ValidationError("One or more storage nodes are outside the current team scope");
      }
      const rows = mapped.filter(
        (grant) =>
          grant.storageNodeId &&
          validNodeIds.has(grant.storageNodeId) &&
          (grant.canRead || grant.canWrite || grant.canDelete),
      );
      const seen = new Set<string>();
      const uniqueRows = rows.filter((grant) => {
        const key = `${grant.storageNodeId}\0${grant.pathPrefix}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (uniqueRows.length > 0) {
        await tx.userStorageAccess.createMany({ data: uniqueRows, skipDuplicates: true });
      }
    }
  });
}
