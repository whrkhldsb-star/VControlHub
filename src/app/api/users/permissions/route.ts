import { NextResponse } from "next/server";
import { z } from "zod";

import { ALL_PERMISSIONS, type Permission } from "@/lib/auth/rbac";
import { auditUserAction } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import {
  assertUserInActorScope,
  teamWhere,
} from "@/lib/auth/team-scope";
import { AuthError, NotFoundError, ValidationError } from "@/lib/errors";
import { getStorageAccessUsage } from "@/lib/storage/access-control";
import { applyUserPermissionPatch } from "./route-patch";
import { assertAdminAccessMayBeRemoved, withAdminInvariantLock } from "@/lib/user/admin-invariant";

export const dynamic = "force-dynamic";

const storageAccessItemSchema = z.object({
  id: z.string().optional(),
  storageNodeId: z.string().min(1),
  pathPrefix: z.string().optional(),
  canRead: z.boolean().optional(),
  canWrite: z.boolean().optional(),
  canDelete: z.boolean().optional(),
  quotaBytes: z.union([z.string(), z.number(), z.null()]).optional(),
  maxFileBytes: z.union([z.string(), z.number(), z.null()]).optional(),
});

const patchPermissionsSchema = z.object({
  userId: z.string().min(1),
  roleKeys: z.array(z.string()).optional(),
  permissionKeys: z.array(z.string()).optional(),
  storageAccess: z.array(storageAccessItemSchema).optional(),
});


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
  return withApiRoute(request, { permission: "user:read" }, async ({ session }) => {
    if (!session) throw new AuthError("Unauthorized");
    const { userId } = parseSearchParams(
      request,
      z.object({ userId: z.string().trim().min(1, "Missing userId Parameter") }),
    );
    await assertUserInActorScope(session, userId);
    const nodeScope = teamWhere(session);

    const [user, roles, permissions, storageNodes] = await Promise.all([
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
          storageAccess: {
            where: { storageNode: nodeScope },
            include: {
              storageNode: {
                select: { id: true, name: true, driver: true, basePath: true },
              },
            },
            orderBy: [{ storageNode: { name: "asc" } }, { pathPrefix: "asc" }],
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
        take: 500,
      }),
    ]);

    if (!user) {
      throw new NotFoundError("User not found");
    }

    const customRoleKey = `user:${userId}:custom`;
    const effectivePermissions = Array.from(
      new Set(
        user.roles.flatMap((userRole) =>
          userRole.role.permissions.map(
            (rolePermission) => rolePermission.permission.key,
          ),
        ),
      ),
    ).sort();
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
        directPermissionKeys,
        storageAccess: await serializeStorageAccessGrants(user.storageAccess),
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
    });
  });
}

export async function PATCH(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "user:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "Operation failed",
      bodySchema: patchPermissionsSchema,
    },
    async ({ session, body: parsedData }) => {
      if (!session)
        throw new AuthError("Not authenticated");

      // Prevent self-modification of permissions (privilege escalation).
      if (parsedData.userId === session.userId) {
        return NextResponse.json(
          { error: "Cannot modify your own permissions" },
          { status: 403 },
        );
      }

      await assertUserInActorScope(session, parsedData.userId);

      const targetUser = await prisma.user.findUnique({
        where: { id: parsedData.userId },
        select: { id: true, username: true },
      });
      if (!targetUser) {
        throw new NotFoundError("User not found");
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
          `Unknown permission keys: ${unknownPermissionKeys.join(", ")}`,
        );
      }
      const permissionKeys = requestedPermissionKeys as Permission[] | undefined;
      const storageAccess = Array.isArray(parsedData.storageAccess)
        ? parsedData.storageAccess
        : undefined;

			const applyPatch = () => applyUserPermissionPatch({
				session,
				parsedData,
				targetUsername: targetUser.username,
				roleKeys,
				permissionKeys,
				storageAccess,
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
        },
        "WARNING",
        session.currentTeamId,
      );

      return NextResponse.json({ success: true });
    },
  );
}
