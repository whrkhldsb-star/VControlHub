import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { getPermissionsFromRoles, type RoleKey } from "@/lib/auth/rbac";
import { resolveSessionPermissions } from "@/lib/auth/identity-templates";
import { listIdentityTemplates } from "@/lib/auth/identity-template-service";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { t } from "@/lib/i18n/translations";
import { getStorageAccessUsage } from "@/lib/storage/access-control";
import { setAccountType } from "@/lib/user/account-type";
import { applyResourceNarrowing } from "./route-patch";

export const dynamic = "force-dynamic";

/**
 * Platform administrators view and change one account: whether it is a
 * platform administrator or a customer account (customer + identity
 * template), and which of its customer's servers and storage paths it is
 * narrowed to.
 */

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
  account: z.discriminatedUnion("type", [
    z.object({ type: z.literal("admin") }),
    z.object({ type: z.literal("customer"), teamId: z.string().min(1), identityTemplateId: z.string().min(1).nullable().optional() }),
  ]).optional(),
  storageAccess: z.array(storageAccessItemSchema).max(5000).optional(),
  storageAccessScopeIds: z.array(z.string().min(1)).max(5000).optional(),
  serverAccess: z.array(serverAccessItemSchema).max(5000).optional(),
  serverAccessScopeIds: z.array(z.string().min(1)).max(5000).optional(),
});

const PERMISSION_CONFIG_BODY_LIMIT = 4 * 1024 * 1024;


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
  return withApiRoute(request, { permission: "user:manage" }, async () => {
    const { userId } = parseSearchParams(
      request,
      z.object({ userId: z.string().trim().min(1, "Missing userId Parameter") }),
    );
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        roles: { select: { role: { select: { key: true } } } },
        teamMembership: {
          select: {
            teamId: true,
            team: { select: { name: true, deletedAt: true } },
            identityTemplateId: true,
            identityTemplate: { select: { permissions: true } },
          },
        },
        storageAccess: {
          include: { storageNode: { select: { id: true, name: true, driver: true, basePath: true } } },
          orderBy: [{ storageNode: { name: "asc" } }, { pathPrefix: "asc" }],
        },
        serverAccess: { orderBy: { server: { name: "asc" } } },
      },
    });
    if (!user) throw new NotFoundError(apiCopy("apiCopy.user.not.found.4a1793e9"));

    const roles = user.roles.map((entry) => entry.role.key).filter((key): key is RoleKey => key === "admin");
    const isAdmin = roles.includes("admin");
    const membership = isAdmin ? null : user.teamMembership;
    const teamId = membership && !membership.team.deletedAt ? membership.teamId : null;
    const [templates, customers, storageNodes, servers] = await Promise.all([
      listIdentityTemplates(),
      prisma.team.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { createdAt: "asc" }, take: 500 }),
      teamId
        ? prisma.storageNode.findMany({ where: { teamId }, select: { id: true, name: true, driver: true, basePath: true }, orderBy: { name: "asc" }, take: 5000 })
        : [],
      teamId
        ? prisma.server.findMany({ where: { teamId }, select: { id: true, name: true, operatingSystem: true, teamId: true }, orderBy: { name: "asc" }, take: 5000 })
        : [],
    ]);
    const effectivePermissions = resolveSessionPermissions({
      roles,
      accountPermissions: getPermissionsFromRoles(roles),
      identityPermissions: teamId && membership ? membership.identityTemplate.permissions : null,
    }).sort();
    const visibleServerIds = new Set(servers.map((server) => server.id));
    const visibleNodeIds = new Set(storageNodes.map((node) => node.id));

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        accountType: isAdmin ? "admin" : "customer",
        teamId: membership?.teamId ?? null,
        identityTemplateId: membership?.identityTemplateId ?? null,
        effectivePermissions,
        storageAccess: await serializeStorageAccessGrants(user.storageAccess.filter((grant) => visibleNodeIds.has(grant.storageNodeId))),
        serverAccess: user.serverAccess.filter((grant) => visibleServerIds.has(grant.serverId)),
      },
      identityTemplates: templates.map((template) => ({ id: template.id, name: template.name, isBuiltin: template.isBuiltin, permissions: template.permissions })),
      customers,
      storageNodes,
      servers,
    });
  });
}

export async function PATCH(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "user:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      maxBodyBytes: PERMISSION_CONFIG_BODY_LIMIT,
      errorMessage: apiCopy("apiCopy.operation.failed.4e1af7c7"),
      bodySchema: patchPermissionsSchema,
    },
    async ({ session, body }) => {
      // An administrator cannot demote itself or edit its own resource scope.
      if (body.userId === session.userId) {
        return NextResponse.json({ error: apiCopy("apiCopy.cannot.modify.your.own.permissions.4a69d473") }, { status: 403 });
      }
      const target = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true, username: true } });
      if (!target) throw new NotFoundError(apiCopy("apiCopy.user.not.found.4a1793e9"));

      if (body.account) await setAccountType(target.id, body.account, session);

      if (body.storageAccess !== undefined || body.serverAccess !== undefined) {
        const membership = await prisma.teamMember.findUnique({ where: { userId: target.id }, select: { teamId: true } });
        if (!membership) throw new ValidationError(t("backend.user.adminResourceAccessIsRoleBased"));
        await applyResourceNarrowing({
          userId: target.id,
          teamId: membership.teamId,
          storageAccess: body.storageAccess,
          storageAccessScopeIds: body.storageAccessScopeIds,
          serverAccess: body.serverAccess,
          serverAccessScopeIds: body.serverAccessScopeIds,
        });
      }

      await auditUserAction(
        session.userId,
        "user.permission_update",
        {
          targetUsername: target.username,
          account: body.account ?? null,
          storageAccessCount: body.storageAccess?.length ?? null,
          serverAccessCount: body.serverAccess?.length ?? null,
        },
        "WARNING",
        session.currentTeamId,
      );
      return NextResponse.json({ success: true });
    },
  );
}
