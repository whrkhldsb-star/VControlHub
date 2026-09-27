import type { SessionPayload } from "@/lib/auth/session";
import { isGlobalTeamManager } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/translations";
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
  storageAccessScopeIds?: string[];
  serverAccess?: Array<{
    serverId: string;
    canRead: boolean;
    canConnect: boolean;
    canManage: boolean;
    canFileRead: boolean;
    canFileWrite: boolean;
    canFileDelete: boolean;
  }>;
  serverAccessScopeIds?: string[];
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
  storageAccessScopeIds: string[] | undefined;
  serverAccess: PermissionPatch["serverAccess"] | undefined;
  serverAccessScopeIds: string[] | undefined;
}) {
  const { session, parsedData, targetUsername, roleKeys, permissionKeys, storageAccess, storageAccessScopeIds, serverAccess, serverAccessScopeIds } = input;
  // Delegation rule: a non-global manager may only hand out what they already
  // hold. Without this, any delegated `user:manage` could mint an `admin`
  // (or any superset) for a colluding account — a full platform takeover.
  const actorIsGlobalManager = isGlobalTeamManager(session);
  const actorPermissions = new Set<string>(session.permissions ?? []);
  await prisma.$transaction(async (tx) => {
    if (roleKeys) {
      const customRoleKey = `user:${parsedData.userId}:custom`;
      const roles = await tx.role.findMany({
        where: { key: { in: roleKeys } },
        select: { id: true, key: true, permissions: { select: { permission: { select: { key: true } } } } },
        take: roleKeys.length,
      });
      const foundRoleKeys = new Set(roles.map((role: { key: string }) => role.key));
      const missingRoleKeys = roleKeys.filter((key) => !foundRoleKeys.has(key));
      if (missingRoleKeys.length > 0) {
        // Reject before any deleteMany: silently applying a subset would
        // strip roles the caller did not intend to remove and still report success.
        throw new ValidationError(
          t("backend.user.unknownRoleKeys", { keys: missingRoleKeys.join(", ") }),
        );
      }
      if (!actorIsGlobalManager) {
        if (roles.some((role) => role.key === "admin")) {
          throw new ForbiddenError(t("backend.user.cannotGrantAdminRole"));
        }
        const beyondActor = roles.filter((role) =>
          role.permissions.some((grant) => !actorPermissions.has(grant.permission.key)),
        );
        if (beyondActor.length > 0) {
          throw new ForbiddenError(
            t("backend.user.cannotGrantBeyondOwnPermissions", { roles: beyondActor.map((role) => role.key).join(", ") }),
          );
        }
      }
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
        select: { id: true, key: true },
        take: permissionKeys.length,
      });
      const foundPermissionKeys = new Set(
        permissionRows.map((permission: { key: string }) => permission.key),
      );
      const missingPermissionKeys = permissionKeys.filter(
        (key) => !foundPermissionKeys.has(key),
      );
      if (missingPermissionKeys.length > 0) {
        // Same contract as roles: reject instead of silently clearing the
        // custom role's permissions and reporting success.
        throw new ValidationError(
          t("backend.user.unknownPermissionKeys", { keys: missingPermissionKeys.join(", ") }),
        );
      }
      if (!actorIsGlobalManager) {
        const beyondActor = permissionRows.filter(
          (permission: { key: string }) => !actorPermissions.has(permission.key),
        );
        if (beyondActor.length > 0) {
          throw new ForbiddenError(
            t("backend.user.cannotGrantBeyondOwnPermissions", { roles: beyondActor.map((permission) => permission.key).join(", ") }),
          );
        }
      }
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
      // Storage nodes are security roots (they carry connection credentials
      // and user data) like servers: for a non-global actor, only nodes
      // assigned to the actor's *current team* are grantable. The generic
      // teamWhere() would also expose legacy `teamId: null` nodes to every
      // tenant manager — quarantined here like serverTeamWhere() does.
      const nodeScope = actorIsGlobalManager
        ? {}
        : { teamId: session.currentTeamId ?? "__no_team_no_grants__" };
      const scopeIds = storageAccessScopeIds ?? [];
      if (!storageAccessScopeIds || new Set(scopeIds).size !== scopeIds.length || storageAccess.some((grant) => !scopeIds.includes(grant.storageNodeId))) {
        throw new ValidationError(t("backend.user.invalidStorageAccessScope"));
      }
      const validNodeIds = new Set(
        (
          await tx.storageNode.findMany({
            where: { id: { in: scopeIds }, ...nodeScope },
            select: { id: true },
            take: scopeIds.length || 1,
          })
        ).map((node) => node.id),
      );
      if (validNodeIds.size !== scopeIds.length) throw new ValidationError(t("backend.user.unknownStorageNodeInWorkspace"));
      await tx.userStorageAccess.deleteMany({
        where: { userId: parsedData.userId, storageNodeId: { in: scopeIds } },
      });
      const mapped = storageAccess.map((grant) => ({
        userId: parsedData.userId,
        storageNodeId: String(grant.storageNodeId ?? ""),
        pathPrefix: normalizePathPrefix(grant.pathPrefix),
        // Default deny: an omitted flag must never silently grant read access.
        canRead: grant.canRead ?? false,
        canWrite: grant.canWrite ?? false,
        canDelete: grant.canDelete ?? false,
        quotaBytes: parseNullableBigIntInput(grant.quotaBytes),
        maxFileBytes: parseNullableBigIntInput(grant.maxFileBytes),
      }));
      const outOfTeam = mapped
        .map((grant) => grant.storageNodeId)
        .filter((id) => id && !validNodeIds.has(id));
      if (outOfTeam.length > 0) {
        throw new ValidationError(t("backend.user.storageNodesOutsideCurrentTeamScope"));
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

    if (serverAccess) {
      const serverScope = actorIsGlobalManager
        ? {}
        : { teamId: session.currentTeamId ?? "__no_team_no_grants__" };
      const ids = serverAccess.map((grant) => grant.serverId);
      const scopeIds = serverAccessScopeIds ?? [];
      if (!serverAccessScopeIds || new Set(ids).size !== ids.length || new Set(scopeIds).size !== scopeIds.length || ids.some((id) => !scopeIds.includes(id))) {
        throw new ValidationError(t("backend.user.invalidServerAccessScope"));
      }
      const known = await tx.server.findMany({
        where: { id: { in: scopeIds }, ...serverScope },
        select: { id: true },
        take: scopeIds.length || 1,
      });
      if (known.length !== scopeIds.length) {
        throw new ValidationError(t("backend.user.unknownServerInWorkspace"));
      }
      await tx.userServerAccess.deleteMany({
        where: { userId: parsedData.userId, serverId: { in: scopeIds } },
      });
      if (serverAccess.length > 0) {
        await tx.userServerAccess.createMany({
          data: serverAccess.map((grant) => ({ userId: parsedData.userId, ...grant })),
        });
      }
    }
  });
}
