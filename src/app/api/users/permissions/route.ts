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
import { isCaseInsensitiveStorageNode, normalizeStorageTargetDirectory } from "@/lib/storage/path-utils";
import { withAccountPermissionChange } from "@/lib/user/account-type";
import { afterOption, optionFilter, readOptionPage } from "@/lib/user/permission-options";
import { permissionAccountIdentity, permissionVersion, prepareResourceNarrowing, readPermissionAccount } from "./route-patch";

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
    storageNode: { id: string; name: string; driver: string; basePath: string; server?: { operatingSystem?: string | null } | null };
    createdAt: Date;
    updatedAt: Date;
  }>,
) {
  const prefixes = grants.flatMap(grant => {
    const normalized = normalizeStorageTargetDirectory(grant.pathPrefix);
    const insensitive = isCaseInsensitiveStorageNode(grant.storageNode);
    return normalized.ok ? [{ id: grant.id, node: grant.storageNodeId, prefix: insensitive ? normalized.path.toLowerCase() : normalized.path, insensitive }] : [];
  });
  // A single query for the returned grants. starts_with treats every path character literally.
  const usage = prefixes.length ? await prisma.$queryRaw<Array<{ id: string; bytes: string }>>`
    SELECT g.id, COALESCE(sum(f.size), 0)::text AS bytes
    FROM jsonb_to_recordset(${JSON.stringify(prefixes)}::jsonb) AS g(id text, node text, prefix text, insensitive boolean)
    JOIN file_entries f ON f."storageNodeId" = g.node AND NOT f."isDeleted" AND f."entryType" = 'FILE'
      AND (
        g.prefix = ''
        OR (NOT g.insensitive AND (f."relativePath" = g.prefix OR starts_with(f."relativePath", g.prefix || '/')))
        OR (g.insensitive AND (lower(f."relativePath") = g.prefix OR starts_with(lower(f."relativePath"), g.prefix || '/')))
      )
    GROUP BY g.id` : [];
  const byGrant = new Map(usage.map(row => [row.id, row.bytes]));
  return grants.map(grant => {
    const { server: _server, ...storageNode } = grant.storageNode;
    return {
      id: grant.id, storageNodeId: grant.storageNodeId, storageNode, pathPrefix: grant.pathPrefix,
      canRead: grant.canRead, canWrite: grant.canWrite, canDelete: grant.canDelete,
      quotaBytes: serializeBigInt(grant.quotaBytes),
      maxFileBytes: serializeBigInt(grant.maxFileBytes),
      usedBytes: byGrant.get(grant.id) ?? "0",
      createdAt: grant.createdAt.toISOString(),
      updatedAt: grant.updatedAt.toISOString(),
    };
  });
}

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "user:manage" }, async () => {
    const query = parseSearchParams(request, z.object({
      userId: z.string().trim().min(1, "Missing userId Parameter"),
      pageSize: z.coerce.number().int().min(1).max(200).optional(),
      includeAssigned: z.literal("1").optional(),
      resource: z.enum(["servers", "storageNodes", "identityTemplates"]).optional(),
      search: z.string().trim().max(120).optional(), id: z.string().min(1).optional(),
      templateAfter: z.string().min(1).optional(), storageAfter: z.string().min(1).optional(), serverAfter: z.string().min(1).optional(),
    }));
    // Browsing a picker only needs the target's customer. Read grants and
    // calculate their usage/version once when the editor opens.
    const user = query.resource ? null : await readPermissionAccount(prisma, query.userId);
    const identity = query.resource ? await prisma.user.findUnique({
      where: { id: query.userId }, select: permissionAccountIdentity,
    }) : user;
    if (!identity) throw new NotFoundError(apiCopy("apiCopy.user.not.found.4a1793e9"));

    const roles = identity.roles.map((entry) => entry.role.key).filter((key): key is RoleKey => key === "admin");
    const isAdmin = roles.includes("admin");
    const membership = isAdmin ? null : identity.teamMembership;
    const teamId = membership && !membership.team.deletedAt ? membership.teamId : null;
    const scope = { teamId, team: { deletedAt: null }, ...optionFilter(query) };
    const orderBy = [{ name: "asc" }, { id: "asc" }] satisfies Array<{ name?: "asc"; id?: "asc" }>;
    const optionsQuery = { ...query, pageSize: query.pageSize ?? (query.resource ? 25 : undefined) };
    const emptyPage = { items: [], nextCursor: null };
    const [templates, customers, nodes, serverPage] = await Promise.all([
      !query.resource || query.resource === "identityTemplates"
        ? identityTemplateOptions({ ...optionsQuery, after: query.templateAfter }) : emptyPage,
      user ? listLiveCustomerOptions() : [],
      teamId && (!query.resource || query.resource === "storageNodes")
        ? readOptionPage({ ...optionsQuery, after: query.storageAfter }, (after, take) => prisma.storageNode.findMany({
          where: { ...scope, ...afterOption(after) }, select: { id: true, name: true, driver: true, basePath: true }, orderBy, take,
        }), id => prisma.storageNode.findFirst({ where: { id, teamId }, select: { id: true, name: true } })) : emptyPage,
      teamId && (!query.resource || query.resource === "servers")
        ? readOptionPage({ ...optionsQuery, after: query.serverAfter }, (after, take) => prisma.server.findMany({
          where: { ...scope, ...afterOption(after) }, select: { id: true, name: true, operatingSystem: true, teamId: true }, orderBy, take,
        }), id => prisma.server.findFirst({ where: { id, teamId }, select: { id: true, name: true } })) : emptyPage,
    ]);
    const options = {
      nextCursor: { servers: serverPage.nextCursor, storageNodes: nodes.nextCursor, identityTemplates: templates.nextCursor },
      identityTemplates: templates.items.map(({ id, name, isBuiltin, permissions }) => ({ id, name, isBuiltin, permissions })),
      storageNodes: nodes.items,
      servers: serverPage.items,
    };
    if (!user) return NextResponse.json(options);
    const effectivePermissions = resolveSessionPermissions({
      roles,
      accountPermissions: getPermissionsFromRoles(roles),
      identityPermissions: teamId && membership ? membership.identityTemplate.permissions : null,
    }).sort();
    const visibleServerIds = new Set(options.servers.map((server) => server.id));
    const visibleNodeIds = new Set(options.storageNodes.map((node) => node.id));

    return NextResponse.json({
      ...options,
      version: permissionVersion(user),
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        accountType: isAdmin ? "admin" : "customer",
        teamId: membership?.teamId ?? null,
        identityTemplateId: membership?.identityTemplateId ?? null,
        effectivePermissions,
        storageAccess: await serializeStorageAccessGrants(user.storageAccess.filter((grant) => query.includeAssigned
          ? teamId !== null && grant.storageNode.teamId === teamId : visibleNodeIds.has(grant.storageNodeId))),
        serverAccess: user.serverAccess.filter((grant) => query.includeAssigned
          ? teamId !== null && grant.server.teamId === teamId : visibleServerIds.has(grant.serverId)),
      },
      customers,
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
      }, undefined, body.account?.type === "customer" ? body.account.teamId : undefined);
      return NextResponse.json({ success: true, version });
    },
  );
}
