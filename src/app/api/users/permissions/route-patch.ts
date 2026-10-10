import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/translations";
import { parseNullableBigIntInput } from "@/lib/storage/access-control";
import { normalizeStorageTargetDirectory } from "@/lib/storage/path-utils";

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
export async function applyResourceNarrowing(input: {
  userId: string;
  teamId: string;
  storageAccess?: PermissionPatch["storageAccess"];
  storageAccessScopeIds?: string[];
  serverAccess?: PermissionPatch["serverAccess"];
  serverAccessScopeIds?: string[];
}) {
  const { userId, teamId, storageAccess, storageAccessScopeIds, serverAccess, serverAccessScopeIds } = input;
  await prisma.$transaction(async (tx) => {
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
      if (validNodeIds.size !== scopeIds.length) throw new ValidationError(t("backend.user.unknownStorageNodeInWorkspace"));
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
      await tx.userStorageAccess.deleteMany({
        where: { userId: userId, storageNodeId: { in: scopeIds } },
      });
      // Keep grants with every flag cleared: without any row a node is not
      // narrowed at all, so a cleared grant is how a node gets blocked.
      const rows = mapped.filter((grant) => grant.storageNodeId && validNodeIds.has(grant.storageNodeId));
      if (rows.length > 0) {
        await tx.userStorageAccess.createMany({ data: rows, skipDuplicates: true });
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
        throw new ValidationError(t("backend.user.unknownServerInWorkspace"));
      }
      await tx.userServerAccess.deleteMany({
        where: { userId: userId, serverId: { in: scopeIds } },
      });
      if (serverAccess.length > 0) {
        await tx.userServerAccess.createMany({
          data: serverAccess.map((grant) => ({ userId: userId, ...grant })),
        });
      }
    }
  });
}
