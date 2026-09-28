import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, type Permission, type RoleKey } from "@/lib/auth/rbac";
import { scopePermissionsToWorkspace } from "@/lib/auth/tenant-permissions";
import { auditUserAction } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import {
  assertUserInActorScope,
  isGlobalTeamManager,
} from "@/lib/auth/team-scope";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/translations";
import { getStorageAccessUsage } from "@/lib/storage/access-control";
import { applyUserPermissionPatch } from "./route-patch";
import { assertAdminAccessMayBeRemoved, withAdminInvariantLock } from "@/lib/user/admin-invariant";

export const dynamic = "force-dynamic";

const MAX_SIGNED_BIGINT = BigInt("9223372036854775807");
const nullableBigIntInputSchema = z.union([z.string(), z.number(), z.null()]).optional().refine((value) => {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (!/^\d+$/.test(trimmed)) return false;
  try {
    return BigInt(trimmed) <= MAX_SIGNED_BIGINT;
  } catch {
    return false;
  }
});

const storageAccessItemSchema = z.object({
  id: z.string().optional(),
  storageNodeId: z.string().min(1),
  pathPrefix: z.string().max(500).optional(),
  canRead: z.boolean().optional(),
  canWrite: z.boolean().optional(),
  canDelete: z.boolean().optional(),
  quotaBytes: nullableBigIntInputSchema,
  maxFileBytes: nullableBigIntInputSchema,
});

const serverAccessItemSchema = z.object({
  serverId: z.string().min(1),
  canRead: z.boolean(),
  canConnect: z.boolean(),
  canManage: z.boolean(),
  canFileRead: z.boolean(),
  canFileWrite: z.boolean(),
  canFileDelete: z.boolean(),
});

const patchPermissionsSchema = z.object({
  userId: z.string().min(1),
  roleKeys: z.array(z.string()).optional(),
  permissionKeys: z.array(z.string()).optional(),
  storageAccess: z.array(storageAccessItemSchema).max(5000).optional(),
  storageAccessScopeIds: z.array(z.string().min(1)).max(5000).optional(),
  serverAccess: z.array(serverAccessItemSchema).max(5000).optional(),
  serverAccessScopeIds: z.array(z.string().min(1)).max(5000).optional(),
});

const PERMISSION_CONFIG_BODY_LIMIT = 4 * 1024 * 1024;


function isPermissionKey(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}

function serializeBigInt(value: bigint | null | undefined) {
  return value === null || value === undefined ? null : value.toString();
}

async function serializeStorageAccessGrants(
  grants: Array<{
    id: string;
    storageNodeId: string;
    pathPrefix: string;
    canRead: boolean;
    canWrite: boolean;
    canDelete: boolean;
    quotaBytes: bigint | null;
    maxFileBytes: bigint | null;
    storageNode: { id: string; name: string; driver: string; basePath: string };
    createdAt: Date;
    updatedAt: Date;
  }>,
) {
  return Promise.all(
    grants.map(async (grant) => ({
      id: grant.id,
      storageNodeId: grant.storageNodeId,
      storageNode: grant.storageNode,
      pathPrefix: grant.pathPrefix,
      canRead: grant.canRead,
      canWrite: grant.canWrite,
      canDelete: grant.canDelete,
      quotaBytes: serializeBigInt(grant.quotaBytes),
      maxFileBytes: serializeBigInt(grant.maxFileBytes),
      usedBytes: (
        await getStorageAccessUsage({
          storageNodeId: grant.storageNodeId,
          pathPrefix: grant.pathPrefix,
        })
      ).toString(),
      createdAt: grant.createdAt.toISOString(),
      updatedAt: grant.updatedAt.toISOString(),
    })),
  );
}

export async function GET(request: Request) {
  return withApiRoute(request, { permissions: ["user:read", "team:member:manage"] }, async ({ session }) => {
    const { userId } = parseSearchParams(
      request,
      z.object({ userId: z.string().trim().min(1, "Missing userId Parameter") }),
    );
    await assertUserInActorScope(session, userId);
    // Same security-root scoping as the PATCH path (route-patch.ts): storage
    // nodes are quarantined for non-global actors — legacy `teamId: null`
    // nodes are not offered for grant.
    const nodeScope = isGlobalTeamManager(session)
      ? {}
      : { teamId: session.currentTeamId ?? "__no_team_no_grants__" };

    const [user, roles, permissions, storageNodes, servers] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          displayName: true,
          roles: {
            include: {
              role: {
                include: { permissions: { include: { permission: true } } },
              },
            },
          },
          teamMemberships: {
            where: { teamId: session.currentTeamId ?? "__no_active_team__" },
            select: {
              role: true,
              accessRole: true,
              permissionTemplate: {
                select: { teamId: true, kind: true, roleKeys: true, permissions: true },
              },
            },
            take: 1,
          },
          storageAccess: {
            where: { storageNode: nodeScope },
            include: {
              storageNode: {
                select: { id: true, name: true, driver: true, basePath: true },
              },
            },
            orderBy: [{ storageNode: { name: "asc" } }, { pathPrefix: "asc" }],
          },
          serverAccess: {
            where: { server: isGlobalTeamManager(session) ? {} : { teamId: session.currentTeamId ?? "__no_team__" } },
            orderBy: { server: { name: "asc" } },
          },
        },
      }),
      // Exclude per-user auto custom roles (user:{id}:custom) from the assignable roster.
      prisma.role.findMany({
        where: { NOT: { key: { startsWith: "user:" } } },
        orderBy: { key: "asc" },
        take: 200,
      }),
      prisma.permission.findMany({ orderBy: { key: "asc" }, take: 500 }),
      prisma.storageNode.findMany({
        where: nodeScope,
        select: { id: true, name: true, driver: true, basePath: true },
        orderBy: { name: "asc" },
        take: 5000,
      }),
      prisma.server.findMany({
        where: isGlobalTeamManager(session) ? {} : { teamId: session.currentTeamId ?? "__no_team__" },
        select: { id: true, name: true, operatingSystem: true, teamId: true },
        orderBy: { name: "asc" },
        take: 5000,
      }),
    ]);

    if (!user) {
      throw new NotFoundError(apiCopy("apiCopy.user.not.found.4a1793e9"));
    }

    const customRoleKey = `user:${userId}:custom`;
    const assignedRoleKeys = user.roles.map((userRole) => userRole.role.key);
    const baseRoles = assignedRoleKeys.filter(
      (key): key is RoleKey => key in DEFAULT_ROLE_PERMISSIONS,
    );
    const accountEffectivePermissions = Array.from(
      new Set(
        user.roles.flatMap((userRole) =>
          userRole.role.permissions.map(
            (rolePermission) => rolePermission.permission.key,
          ),
        ),
      ),
    ).filter(isPermissionKey).sort();
    const membership = user.teamMemberships?.[0] ?? null;
    const effectivePermissions = scopePermissionsToWorkspace({
      roles: baseRoles,
      accountPermissions: accountEffectivePermissions,
      membership: membership ? {
        role: membership.role,
        accessRole: membership.accessRole,
        permissionTemplate: membership.permissionTemplate?.teamId === session.currentTeamId
          && membership.permissionTemplate.kind === "POLICY_GROUP"
          ? membership.permissionTemplate
          : null,
      } : null,
    }).sort();
    const resourceAccessBypassed = baseRoles.includes("admin")
      || membership?.role === "owner"
      || membership?.role === "admin";
    // Direct overrides only (auto custom role) — UI should seed/save this set,
    // not the full effective union of base roles (would bake roles into custom).
    const directPermissionKeys = Array.from(
      new Set(
        user.roles
          .filter((userRole) => userRole.role.key === customRoleKey)
          .flatMap((userRole) =>
            userRole.role.permissions.map(
              (rolePermission) => rolePermission.permission.key,
            ),
          ),
      ),
    ).sort();
    const visibleServerIds = new Set(servers.map((server) => server.id));
    const visibleNodeIds = new Set(storageNodes.map((node) => node.id));

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        roles: user.roles.map((userRole) => ({
          key: userRole.role.key,
          name: userRole.role.name,
        })),
        effectivePermissions,
        resourceAccessBypassed,
        directPermissionKeys,
        storageAccess: await serializeStorageAccessGrants(user.storageAccess.filter((grant) => visibleNodeIds.has(grant.storageNodeId))),
        serverAccess: user.serverAccess.filter((grant) => visibleServerIds.has(grant.serverId)),
      },
      roles: roles.map((role) => ({
        id: role.id,
        key: role.key,
        name: role.name,
        description: role.description,
      })),
      permissions: permissions.map((permission) => ({
        id: permission.id,
        key: permission.key,
        name: permission.name,
        description: permission.description,
      })),
      storageNodes,
      servers,
    });
  });
}

export async function PATCH(request: Request) {
  return withApiRoute(
    request,
    {
      permissions: ["user:manage", "team:member:manage"],
      rateLimit: GENERAL_WRITE_LIMIT,
      maxBodyBytes: PERMISSION_CONFIG_BODY_LIMIT,
      errorMessage: apiCopy("apiCopy.operation.failed.4e1af7c7"),
      bodySchema: patchPermissionsSchema,
    },
    async ({ session, body: parsedData }) => {
      // Prevent self-modification of permissions (privilege escalation).
      if (parsedData.userId === session.userId) {
        return NextResponse.json(
          { error: apiCopy("apiCopy.cannot.modify.your.own.permissions.4a69d473") },
          { status: 403 },
        );
      }

      await assertUserInActorScope(session, parsedData.userId);

      const targetUser = await prisma.user.findUnique({
        where: { id: parsedData.userId },
        select: {
          id: true,
          username: true,
          roles: { select: { role: { select: { key: true } } } },
          teamMemberships: {
            where: { teamId: session.currentTeamId ?? "__no_active_team__" },
            select: { role: true },
            take: 1,
          },
        },
      });
      if (!targetUser) {
        throw new NotFoundError(apiCopy("apiCopy.user.not.found.4a1793e9"));
      }
		const targetIsPlatformAdmin = targetUser.roles?.some((entry) => entry.role.key === "admin") ?? false;
		if (!isGlobalTeamManager(session) && targetIsPlatformAdmin) {
			throw new ForbiddenError(t("backend.user.cannotModifyPlatformAdmin"));
		}
		if (!isGlobalTeamManager(session) && (parsedData.roleKeys !== undefined || parsedData.permissionKeys !== undefined)) {
			throw new ForbiddenError(t("backend.user.accountPermissionsRequirePlatformAdmin"));
		}

      // Drop foreign/own auto custom role keys from assignable roleKeys; custom role is preserved below.
      const roleKeys = Array.isArray(parsedData.roleKeys)
        ? Array.from(
            new Set(
              parsedData.roleKeys
                .map(String)
                .filter(Boolean)
                .filter((key) => !key.startsWith("user:")),
            ),
          )
        : undefined;
      const requestedPermissionKeys = Array.isArray(parsedData.permissionKeys)
        ? Array.from(new Set(parsedData.permissionKeys.map(String)))
        : undefined;
      const unknownPermissionKeys = requestedPermissionKeys?.filter(
        (key) => !isPermissionKey(key),
      );
      if (unknownPermissionKeys && unknownPermissionKeys.length > 0) {
        throw new ValidationError(
          apiCopy("apiCopy.unknown.permission.keys.68fbe9ad", { v0: String(unknownPermissionKeys.join(", ")) }),
        );
      }
      const permissionKeys = requestedPermissionKeys as Permission[] | undefined;
      const storageAccess = Array.isArray(parsedData.storageAccess)
        ? parsedData.storageAccess
        : undefined;
      const storageAccessScopeIds = parsedData.storageAccessScopeIds;
      const serverAccess = parsedData.serverAccess;
      const serverAccessScopeIds = parsedData.serverAccessScopeIds;

      const targetMembershipRole = targetUser.teamMemberships?.[0]?.role;
      const resourceAccessBypassed = (roleKeys !== undefined ? roleKeys.includes("admin") : targetIsPlatformAdmin)
        || targetMembershipRole === "owner"
        || targetMembershipRole === "admin";
      if (resourceAccessBypassed && (storageAccess !== undefined || serverAccess !== undefined)) {
        throw new ValidationError(t("backend.user.adminResourceAccessIsRoleBased"));
      }

			const applyPatch = () => applyUserPermissionPatch({
				session,
				parsedData,
				targetUsername: targetUser.username,
				roleKeys,
				permissionKeys,
				storageAccess,
				storageAccessScopeIds,
				serverAccess,
				serverAccessScopeIds,
			});
			if (roleKeys && !roleKeys.includes("admin")) {
				await withAdminInvariantLock(async () => {
					await assertAdminAccessMayBeRemoved(parsedData.userId);
					await applyPatch();
				});
			} else {
				await applyPatch();
			}

      await auditUserAction(
        session.userId,
        "user.permission_update",
        {
          targetUsername: targetUser.username,
          roleKeys: roleKeys ?? null,
          permissionKeys: permissionKeys ?? null,
          storageAccessCount: storageAccess?.length ?? null,
          serverAccessCount: serverAccess?.length ?? null,
        },
        "WARNING",
        session.currentTeamId,
      );

      return NextResponse.json({ success: true });
    },
  );
}
