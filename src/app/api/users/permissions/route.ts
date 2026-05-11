import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";

import { ALL_PERMISSIONS, type Permission } from "@/lib/auth/rbac";
import { auditUserAction } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { getStorageAccessUsage, parseNullableBigIntInput } from "@/lib/storage/access-control";

export const dynamic = "force-dynamic";

type StorageAccessInput = {
  id?: string;
  storageNodeId: string;
  pathPrefix?: string;
  canRead?: boolean;
  canWrite?: boolean;
  canDelete?: boolean;
  quotaBytes?: string | number | null;
  maxFileBytes?: string | number | null;
};

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

async function serializeStorageAccessGrants(grants: Array<{
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
}>) {
  return Promise.all(grants.map(async (grant) => ({
    id: grant.id,
    storageNodeId: grant.storageNodeId,
    storageNode: grant.storageNode,
    pathPrefix: grant.pathPrefix,
    canRead: grant.canRead,
    canWrite: grant.canWrite,
    canDelete: grant.canDelete,
    quotaBytes: serializeBigInt(grant.quotaBytes),
    maxFileBytes: serializeBigInt(grant.maxFileBytes),
    usedBytes: (await getStorageAccessUsage({ storageNodeId: grant.storageNodeId, pathPrefix: grant.pathPrefix })).toString(),
    createdAt: grant.createdAt.toISOString(),
    updatedAt: grant.updatedAt.toISOString(),
  })));
}

export async function GET(request: Request) {
  const session = await requireSession();
  if (!sessionHasPermission(session, "user:read")) {
    return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  }

  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "缺少 userId 参数" }, { status: 400 });
  }

  const [user, roles, permissions, storageNodes] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        storageAccess: {
          include: { storageNode: { select: { id: true, name: true, driver: true, basePath: true } } },
          orderBy: [{ storageNode: { name: "asc" } }, { pathPrefix: "asc" }],
        },
      },
    }),
    prisma.role.findMany({ orderBy: { key: "asc" } }),
    prisma.permission.findMany({ orderBy: { key: "asc" } }),
    prisma.storageNode.findMany({ select: { id: true, name: true, driver: true, basePath: true }, orderBy: { name: "asc" } }),
  ]);

  if (!user) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  const effectivePermissions = Array.from(new Set(
    user.roles.flatMap((userRole) => userRole.role.permissions.map((rolePermission) => rolePermission.permission.key)),
  )).sort();

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      roles: user.roles.map((userRole) => ({ key: userRole.role.key, name: userRole.role.name })),
      effectivePermissions,
      storageAccess: await serializeStorageAccessGrants(user.storageAccess),
    },
    roles: roles.map((role) => ({ id: role.id, key: role.key, name: role.name, description: role.description })),
    permissions: permissions.map((permission) => ({ id: permission.id, key: permission.key, name: permission.name, description: permission.description })),
    storageNodes,
  });
}

export async function PATCH(request: Request) {
  const session = await requireSession();
  if (!sessionHasPermission(session, "user:manage")) {
    return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  }

  let body: { userId?: string; roleKeys?: string[]; permissionKeys?: string[]; storageAccess?: StorageAccessInput[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

 if (!body.userId) {
 return NextResponse.json({ error: "缺少 userId 参数" }, { status: 400 });
 }

 // Prevent self-modification of permissions (privilege escalation)
 if (body.userId === session.userId) {
 return NextResponse.json({ error: "不能修改自己的权限" }, { status: 403 });
 }

  const targetUser = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true, username: true } });
  if (!targetUser) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  const roleKeys = Array.isArray(body.roleKeys) ? Array.from(new Set(body.roleKeys.map(String).filter(Boolean))) : undefined;
  const permissionKeys = Array.isArray(body.permissionKeys) ? Array.from(new Set(body.permissionKeys.map(String).filter(isPermissionKey))) : undefined;
  const storageAccess = Array.isArray(body.storageAccess) ? body.storageAccess : undefined;

  await prisma.$transaction(async (tx) => {
    if (roleKeys) {
      const roles = await tx.role.findMany({ where: { key: { in: roleKeys } }, select: { id: true } });
      await tx.userRole.deleteMany({ where: { userId: body.userId } });
      if (roles.length > 0) {
        await tx.userRole.createMany({
          data: roles.map((role) => ({ userId: body.userId!, roleId: role.id })),
          skipDuplicates: true,
        });
      }
    }

    if (permissionKeys) {
      const customRoleKey = `user:${body.userId}:custom`;
      const customRole = await tx.role.upsert({
        where: { key: customRoleKey },
        update: { name: `${targetUser.username} 的自定义权限`, description: "用户权限配置页自动维护" },
        create: { key: customRoleKey, name: `${targetUser.username} 的自定义权限`, description: "用户权限配置页自动维护" },
      });
      const permissionRows = await tx.permission.findMany({ where: { key: { in: permissionKeys } }, select: { id: true } });
      await tx.rolePermission.deleteMany({ where: { roleId: customRole.id } });
      if (permissionRows.length > 0) {
        await tx.rolePermission.createMany({
          data: permissionRows.map((permission) => ({ roleId: customRole.id, permissionId: permission.id })),
          skipDuplicates: true,
        });
      }
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: body.userId!, roleId: customRole.id } },
        update: {},
        create: { userId: body.userId!, roleId: customRole.id },
      });
    }

    if (storageAccess) {
      await tx.userStorageAccess.deleteMany({ where: { userId: body.userId } });
      const validNodeIds = new Set((await tx.storageNode.findMany({ select: { id: true } })).map((node) => node.id));
      const rows = storageAccess
        .map((grant) => ({
          userId: body.userId!,
          storageNodeId: String(grant.storageNodeId ?? ""),
          pathPrefix: normalizePathPrefix(grant.pathPrefix),
          canRead: grant.canRead ?? true,
          canWrite: grant.canWrite ?? false,
          canDelete: grant.canDelete ?? false,
          quotaBytes: parseNullableBigIntInput(grant.quotaBytes),
          maxFileBytes: parseNullableBigIntInput(grant.maxFileBytes),
        }))
        .filter((grant) => grant.storageNodeId && validNodeIds.has(grant.storageNodeId) && (grant.canRead || grant.canWrite || grant.canDelete));

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

  auditUserAction(session.userId, "user.permission_update", {
    targetUsername: targetUser.username,
    roleKeys: roleKeys ?? null,
    permissionKeys: permissionKeys ?? null,
    storageAccessCount: storageAccess?.length ?? null,
  }, "WARNING");

  return NextResponse.json({ success: true });
}
