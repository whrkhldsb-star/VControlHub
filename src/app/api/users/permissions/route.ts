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
  isGlobalTeamManager,
  teamWhere,
} from "@/lib/auth/team-scope";
import { AuthError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  getStorageAccessUsage,
  parseNullableBigIntInput,
} from "@/lib/storage/access-control";

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

function normalizePathPrefix(value: unknown) {
  return String(value ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

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
      prisma.role.findMany({ orderBy: { key: "asc" }, take: 200 }),
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

    const effectivePermissions = Array.from(
      new Set(
        user.roles.flatMap((userRole) =>
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

      const roleKeys = Array.isArray(parsedData.roleKeys)
        ? Array.from(new Set(parsedData.roleKeys.map(String).filter(Boolean)))
        : undefined;
      const permissionKeys = Array.isArray(parsedData.permissionKeys)
        ? Array.from(
            new Set(
              parsedData.permissionKeys.map(String).filter(isPermissionKey),
            ),
          )
        : undefined;
      const storageAccess = Array.isArray(parsedData.storageAccess)
        ? parsedData.storageAccess
        : undefined;

      await prisma.$transaction(async (tx) => {
        if (roleKeys) {
          const roles = await tx.role.findMany({
            where: { key: { in: roleKeys } },
            select: { id: true },
            take: roleKeys.length,
          });
          await tx.userRole.deleteMany({
            where: { userId: parsedData.userId },
          });
          if (roles.length > 0) {
            await tx.userRole.createMany({
              data: roles.map((role) => ({
                userId: parsedData.userId,
                roleId: role.id,
              })),
              skipDuplicates: true,
            });
          }
        }

        if (permissionKeys) {
          const customRoleKey = `user:${parsedData.userId}:custom`;
          const customRole = await tx.role.upsert({
            where: { key: customRoleKey },
            update: {
              name: `${targetUser.username} 's custom permissions`,
              description: "Auto-maintained by user permission config page",
            },
            create: {
              key: customRoleKey,
              name: `${targetUser.username} 's custom permissions`,
              description: "Auto-maintained by user permission config page",
            },
          });
          const permissionRows = await tx.permission.findMany({
            where: { key: { in: permissionKeys } },
            select: { id: true },
            take: permissionKeys.length,
          });
          await tx.rolePermission.deleteMany({
            where: { roleId: customRole.id },
          });
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
            where: {
              userId_roleId: {
                userId: parsedData.userId,
                roleId: customRole.id,
              },
            },
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
          // Global managers may replace the full grant set; team-scoped
          // managers only rewrite grants for nodes they can see so foreign-
          // team ACLs are not silently wiped.
          if (isGlobalTeamManager(session)) {
            await tx.userStorageAccess.deleteMany({
              where: { userId: parsedData.userId },
            });
          } else {
            await tx.userStorageAccess.deleteMany({
              where: {
                userId: parsedData.userId,
                storageNode: nodeScope,
              },
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
            .map((g) => g.storageNodeId)
            .filter((id) => id && !validNodeIds.has(id));
          if (outOfTeam.length > 0) {
            throw new ValidationError(
              "One or more storage nodes are outside the current team scope",
            );
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
            await tx.userStorageAccess.createMany({
              data: uniqueRows,
              skipDuplicates: true,
            });
          }
        }
      });

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
