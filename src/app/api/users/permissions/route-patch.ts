import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { parseNullableBigIntInput } from "@/lib/storage/access-control";
import { normalizeStorageTargetDirectory } from "@/lib/storage/path-utils";

export function readPermissionAccount(db: Prisma.TransactionClient, userId: string) {
  return db.user.findUnique({
    where: { id: userId },
    select: {
      id: true, username: true, displayName: true,
      roles: { select: { role: { select: { key: true } } } },
      teamMembership: {
        select: {
          teamId: true, team: { select: { deletedAt: true } }, identityTemplateId: true,
          identityTemplate: { select: { permissions: true } },
        },
      },
      storageAccess: {
        include: { storageNode: { select: { id: true, name: true, driver: true, basePath: true } } },
        orderBy: [{ storageNodeId: "asc" }, { pathPrefix: "asc" }],
      },
      serverAccess: { orderBy: { serverId: "asc" } },
    },
  });
}

/** Hash only persisted inputs to authorization. Usage counters and resource
 * display names may change while an administrator is editing. */
export function permissionVersion(account: NonNullable<Awaited<ReturnType<typeof readPermissionAccount>>>) {
  const member = account.teamMembership;
  const snapshot = [
    account.id, account.roles.map(({ role }) => role.key).sort(),
    member && [member.teamId, member.team.deletedAt, member.identityTemplateId, [...member.identityTemplate.permissions].sort()],
    account.serverAccess.map(row => [row.serverId, row.canRead, row.canConnect, row.canManage, row.canFileRead, row.canFileWrite, row.canFileDelete]),
    account.storageAccess.map(row => [row.storageNodeId, row.pathPrefix, row.canRead, row.canWrite, row.canDelete,
      row.quotaBytes?.toString(), row.maxFileBytes?.toString()]),
  ];
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

type PermissionPatch = {
  userId: string;
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
  const rawPath = String(value ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  const normalized = normalizeStorageTargetDirectory(rawPath);
  if (!normalized.ok) {
    throw new ValidationError(t("backend.user.invalidStoragePath"));
  }
  return normalized.path;
}

function parseStorageLimit(value: unknown) {
  const parsed = parseNullableBigIntInput(value);
  if (value !== null && value !== undefined && String(value).trim() !== "" && parsed === null) {
    throw new ValidationError(t("backend.user.invalidStorageLimit"));
  }
  return parsed;
}

/**
 * Narrow a customer account to specific storage paths and servers of its own
 * customer. Rows are replaced only for the ids listed in the scope arrays, so
 * a partial page of the editor never wipes rows it did not show.
 */
export async function prepareResourceNarrowing(tx: Prisma.TransactionClient, input: {
  userId: string;
  teamId: string;
  storageAccess?: PermissionPatch["storageAccess"];
  storageAccessScopeIds?: string[];
  serverAccess?: PermissionPatch["serverAccess"];
  serverAccessScopeIds?: string[];
}) {
  const { userId, teamId, storageAccess, storageAccessScopeIds, serverAccess, serverAccessScopeIds } = input;
  const writes: Array<() => PromiseLike<unknown>> = [];
  if (storageAccess) {
    // Only the account's own customer's nodes can be narrowed.
    const nodeScope = { teamId };
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
    if (validNodeIds.size !== scopeIds.length) throw new ValidationError(t("backend.user.unknownStorageNodeInCustomer"));
    const mapped = storageAccess.map((grant) => ({
      userId: userId,
      storageNodeId: String(grant.storageNodeId ?? ""),
      pathPrefix: normalizePathPrefix(grant.pathPrefix),
      // Default deny: an omitted flag must never silently grant read access.
      canRead: grant.canRead ?? false,
      canWrite: grant.canWrite ?? false,
      canDelete: grant.canDelete ?? false,
      quotaBytes: parseStorageLimit(grant.quotaBytes),
      maxFileBytes: parseStorageLimit(grant.maxFileBytes),
    }));
    const outOfTeam = mapped
      .map((grant) => grant.storageNodeId)
      .filter((id) => id && !validNodeIds.has(id));
    if (outOfTeam.length > 0) {
      throw new ValidationError(t("backend.user.storageNodesOutsideCurrentTeamScope"));
    }
    const seen = new Set<string>();
    for (const grant of mapped) {
      const key = `${grant.storageNodeId}\0${grant.pathPrefix}`;
      if (seen.has(key)) {
        throw new ValidationError(t("backend.user.duplicateStorageAccess"));
      }
      seen.add(key);
    }
    writes.push(() => tx.userStorageAccess.deleteMany({
      where: { userId: userId, storageNodeId: { in: scopeIds } },
    }));
    // Keep grants with every flag cleared: without any row a node is not
    // narrowed at all, so a cleared grant is how a node gets blocked.
    const rows = mapped.filter((grant) => grant.storageNodeId && validNodeIds.has(grant.storageNodeId));
    if (rows.length > 0) {
      writes.push(() => tx.userStorageAccess.createMany({ data: rows, skipDuplicates: true }));
    }
  }

  if (serverAccess) {
    const serverScope = { teamId };
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
      throw new ValidationError(t("backend.user.unknownServerInCustomer"));
    }
    writes.push(() => tx.userServerAccess.deleteMany({
      where: { userId: userId, serverId: { in: scopeIds } },
    }));
    if (serverAccess.length > 0) {
      writes.push(() => tx.userServerAccess.createMany({
        data: serverAccess.map((grant) => ({ userId: userId, ...grant })),
      }));
    }
  }
  return async () => {
    for (const write of writes) await write();
  };
}
