import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit/service";
import { getPermissionsFromRoles, type RoleKey } from "@/lib/auth/rbac";
import { resolveSessionPermissions } from "@/lib/auth/identity-templates";
import { identityTemplateOptions } from "@/lib/auth/identity-template-service";
import { listLiveCustomerOptions } from "@/lib/team/service";
import { prisma } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { t } from "@/lib/i18n/service-translations";
import { getStorageAccessUsage } from "@/lib/storage/access-control";
import { withAccountPermissionChange } from "@/lib/user/account-type";
import { optionFilter, readOptionPage } from "@/lib/user/permission-options";
import { permissionVersion, prepareResourceNarrowing, readPermissionAccount } from "./route-patch";

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
  version: z.string().max(64).optional(),
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
    const query = parseSearchParams(request, z.object({
      userId: z.string().trim().min(1, "Missing userId Parameter"),
      pageSize: z.coerce.number().int().min(1).max(200).optional(),
      search: z.string().trim().max(120).optional(), id: z.string().min(1).optional(),
      templateAfter: z.string().min(1).optional(), storageAfter: z.string().min(1).optional(), serverAfter: z.string().min(1).optional(),
    }));
    const user = await readPermissionAccount(prisma, query.userId);
    if (!user) throw new NotFoundError(apiCopy("apiCopy.user.not.found.4a1793e9"));

    const roles = user.roles.map((entry) => entry.role.key).filter((key): key is RoleKey => key === "admin");
    const isAdmin = roles.includes("admin");
    const membership = isAdmin ? null : user.teamMembership;
    const teamId = membership && !membership.team.deletedAt ? membership.teamId : null;
    const scope = { teamId, team: { deletedAt: null }, ...optionFilter(query) };
    const orderBy = [{ name: "asc" }, { id: "asc" }] satisfies Array<{ name?: "asc"; id?: "asc" }>;
    const [templates, customers, nodes, serverPage] = await Promise.all([
      identityTemplateOptions({ ...query, after: query.templateAfter }),
      listLiveCustomerOptions(),
      readOptionPage({ ...query, after: query.storageAfter }, (after, take) => teamId ? prisma.storageNode.findMany({
        where: scope, select: { id: true, name: true, driver: true, basePath: true }, orderBy, take,
        ...(after ? { cursor: { id: after, teamId }, skip: 1 } : {}),
      }) : Promise.resolve([])),
      readOptionPage({ ...query, after: query.serverAfter }, (after, take) => teamId ? prisma.server.findMany({
        where: scope, select: { id: true, name: true, operatingSystem: true, teamId: true }, orderBy, take,
        ...(after ? { cursor: { id: after, teamId }, skip: 1 } : {}),
      }) : Promise.resolve([])),
    ]);
    const storageNodes = nodes.items;
    const servers = serverPage.items;
    const effectivePermissions = resolveSessionPermissions({
      roles,
      accountPermissions: getPermissionsFromRoles(roles),
      identityPermissions: teamId && membership ? membership.identityTemplate.permissions : null,
    }).sort();
    const visibleServerIds = new Set(servers.map((server) => server.id));
    const visibleNodeIds = new Set(storageNodes.map((node) => node.id));

    return NextResponse.json({
      version: permissionVersion(user),
      nextCursor: { servers: serverPage.nextCursor, storageNodes: nodes.nextCursor, identityTemplates: templates.nextCursor },
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
      identityTemplates: templates.items.map((template) => ({ id: template.id, name: template.name, isBuiltin: template.isBuiltin, permissions: template.permissions })),
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
      const version = await withAccountPermissionChange(body.userId, session, async (tx, changeType) => {
        const target = await readPermissionAccount(tx, body.userId);
        if (!target) throw new NotFoundError(apiCopy("apiCopy.user.not.found.4a1793e9"));
        if (!body.version || body.version !== permissionVersion(target)) {
          throw new ConflictError(t("backend.concurrency.lockBusy"));
        }
        const previousTeamId = target.teamMembership?.teamId ?? null;
        const teamId = body.account ? (body.account.type === "customer" ? body.account.teamId : null) : previousTeamId;
        let applyGrants;
        if (body.storageAccess !== undefined || body.serverAccess !== undefined) {
          if (!teamId) throw new ValidationError(t("backend.user.adminResourceAccessIsRoleBased"));
          applyGrants = await prepareResourceNarrowing(tx, { ...body, teamId });
        }
        if (body.account) await changeType(body.account);
        await applyGrants?.();
        await writeAuditLog({
          actorType: "USER", actorId: session.userId, action: "user.permission_update", severity: "WARNING",
          teamId: teamId ?? previousTeamId,
          detail: {
            targetUsername: target.username,
            account: body.account ?? null,
            storageAccessCount: body.storageAccess?.length ?? null,
            serverAccessCount: body.serverAccess?.length ?? null,
          },
        }, tx);
        const updated = await readPermissionAccount(tx, body.userId);
        return permissionVersion(updated!);
      });
      return NextResponse.json({ success: true, version });
    },
  );
}
