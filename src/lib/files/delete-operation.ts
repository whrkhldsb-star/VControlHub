import { isCaseInsensitiveStorageNode } from "@/lib/storage/path-utils";
import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { auditUserAction } from "@/lib/audit/service";
import { localPathVersion, localRootIdentity } from "@/lib/storage/local-identity";
import { createAgentFileClient } from "@/lib/storage/agent-file-client";
import { lockStorageFileOverwrite } from "@/lib/storage/file-overwrite-lock";
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import {
  assertStorageAccess,
  getStorageAccessCapabilities,
  getStorageAccessCapabilityKey,
} from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import { ForbiddenError, BusinessError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { serviceT } from "@/lib/i18n/service-locale";
import type { Locale } from "@/lib/i18n/core";
import { getErrorMessage } from "@/lib/http/error-message";
import type { StorageDeleteActionState } from "@/app/storage/actions-helpers";
import { tryAcquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { apiCopy } from "@/lib/i18n/api-copy";
import { SSH_KEY_CREDENTIAL_SELECT } from "@/lib/ssh/ssh-key-crypto";

export async function findAffectedShareIds(input: {
  storageNodeId: string;
  relativePath: string;
  isDirectory: boolean;
  caseInsensitive?: boolean;
}): Promise<string[]> {
  const mode = input.caseInsensitive ? { mode: "insensitive" as const } : {};
  const shares = await prisma.shareLink.findMany({
    where: {
      storageNodeId: input.storageNodeId,
      revokedAt: null,
      OR: [
        { path: input.caseInsensitive ? { equals: input.relativePath, mode: "insensitive" as const } : input.relativePath },
        ...(input.isDirectory
          ? [{ path: { startsWith: escapeLikeLiteral(`${input.relativePath}/`), ...mode } }]
          : []),
        { entryType: "DIRECTORY" },
      ],
    },
    select: { id: true, path: true, entryType: true },
  });
  const norm = (value: string) => (input.caseInsensitive ? value.toLowerCase() : value);
  const target = norm(input.relativePath);
  return shares
    .filter((share) => {
      const sharePath = norm(share.path);
      return (
        sharePath === target ||
        (input.isDirectory && sharePath.startsWith(`${target}/`)) ||
        (share.entryType === "DIRECTORY" &&
          target.startsWith(`${sharePath.replace(/\/+$/, "")}/`))
      );
    })
    .map((share) => share.id);
}

export async function executeDeleteFile(
  session: SessionPayload,
  formData: FormData,
  locale?: Locale,
): Promise<StorageDeleteActionState> {

  const t = await serviceT(locale);
  let release: (() => Promise<void>) | null = null;
  let unlockPath: (() => Promise<void>) | undefined;
  try {
    const fileEntryId = String(formData.get("fileEntryId") ?? "").trim();

    if (!fileEntryId) {
      return { error: t("storagePage.action.missingFileEntryParam") } satisfies StorageDeleteActionState;
    }

    const entry = await prisma.fileEntry.findFirst({
      where: {
        id: fileEntryId,
        isDeleted: false,
        storageNode: {
          ...teamWhere(session),
        },
      },
      select: {
        id: true,
        name: true,
        entryType: true,
        relativePath: true,
        storageNodeId: true,
        storageNode: {
          select: {
            driver: true,
            agentFileShare: { select: { rootIdentity: true } },
            basePath: true,
            host: true,
            port: true,
            username: true,
            teamId: true,
            hostKeySha256: true,
            server: {
              select: {
                teamId: true,
                host: true,
                port: true,
                username: true,
                connectionType: true,
                password: true,
                hostKeySha256: true,
                operatingSystem: true,
                sshKey: { select: SSH_KEY_CREDENTIAL_SELECT },
              },
            },
          },
        },
      },
    });

    if (!entry) {
      return { error: t("storagePage.action.fileEntryNotFound") } satisfies StorageDeleteActionState;
    }
    release = await tryAcquireAdvisoryLock("storage-file-operation", entry.storageNodeId);
    if (!release) throw new Error(apiCopy("apiCopy.files.op.busy"));
    unlockPath = await lockStorageFileOverwrite(entry.storageNodeId, entry.relativePath);
    const current = await prisma.fileEntry.findFirst({
      where: { id: fileEntryId, isDeleted: false, storageNode: teamWhere(session) },
      select: { relativePath: true, storageNodeId: true, entryType: true, updatedAt: true },
    });
    if (!current || current.relativePath !== entry.relativePath ||
        current.storageNodeId !== entry.storageNodeId || current.entryType !== entry.entryType) {
      throw new Error(apiCopy("apiCopy.files.op.changed"));
    }

    const deleteAccess = await assertStorageAccess({
      session,
      storageNodeId: entry.storageNodeId,
      relativePath: entry.relativePath,
      operation: "delete",
    });
    if (!deleteAccess.allowed) {
      return { error: storageAccessDeniedCopy(deleteAccess.reason, locale) } satisfies StorageDeleteActionState;
    }

    const caseInsensitive = isCaseInsensitiveStorageNode(entry.storageNode);
    const descendants = entry.entryType === "DIRECTORY"
      ? await prisma.fileEntry.findMany({
          where: { storageNodeId: entry.storageNodeId, relativePath: { startsWith: escapeLikeLiteral(`${entry.relativePath}/`), ...(caseInsensitive ? { mode: "insensitive" as const } : {}) }, isDeleted: false },
          select: { id: true, entryType: true, updatedAt: true, relativePath: true },
          take: 10001,
        })
      : [];
    if (descendants.length) {
      if (descendants.length > 10000) {
        throw new BusinessError(t("backend.storageHardening.files.tooManyChildren"));
      }
      // Authorize every descendant in ONE batched check instead of one
      // `assertStorageAccess` round-trip per child — that loop ran up to 10k
      // queries (node lookup + paged grants each) for a single delete and was
      // the slowest write path in the file manager.
      const capabilities = await getStorageAccessCapabilities({
        session,
        targets: descendants.map((child) => ({
          storageNodeId: entry.storageNodeId,
          relativePath: child.relativePath,
        })),
      });
      for (const child of descendants) {
        const key = getStorageAccessCapabilityKey({
          storageNodeId: entry.storageNodeId,
          relativePath: child.relativePath,
        });
        if (key && capabilities.get(key)?.canDelete === false) {
          // Distinguish "no permission on a child" from "entry not found" —
          // the old not-found copy told the user the directory had vanished.
          throw new ForbiddenError(t("backend.storageHardening.files.childDeleteDenied"));
        }
      }
    }

    const affectedShareIds = await findAffectedShareIds({
      storageNodeId: entry.storageNodeId,
      relativePath: entry.relativePath,
      isDirectory: entry.entryType === "DIRECTORY",
      caseInsensitive,
    });
    const local = entry.storageNode.driver === "LOCAL";
    const deletedAgentRoot = local ? await localRootIdentity(entry.storageNode.basePath) : entry.storageNode.agentFileShare?.rootIdentity ?? null;
    const versions = new Map<string, string>();
    if (local) {
      for (const member of [entry, ...descendants]) {
        versions.set(member.id, await localPathVersion(entry.storageNode.basePath, member.relativePath) ?? "absent");
      }
    } else if (entry.storageNode.driver === "AGENT") {
      if (!deletedAgentRoot?.startsWith("v2:")) throw new Error(apiCopy("apiCopy.files.op.changed"));
      const agent = createAgentFileClient(entry.storageNodeId, undefined, deletedAgentRoot);
      for (const member of [entry, ...descendants]) {
        const physical = await agent.stat(member.relativePath);
        if (!physical?.etag || physical.isDirectory !== (member.entryType === "DIRECTORY")) {
          throw new Error(apiCopy("apiCopy.files.op.changed"));
        }
        versions.set(member.id, physical.etag);
      }
    }

    const deleted = { isDeleted: true, deleteBatchId: crypto.randomUUID(), deletedAgentRoot };
    const storageNodeId = entry.storageNodeId;
    const children: Prisma.PrismaPromise<unknown>[] = [];
    if (versions.size) {
      for (const child of descendants) {
        children.push(prisma.fileEntry.update({
          where: { id: child.id, storageNodeId, relativePath: child.relativePath, isDeleted: false, updatedAt: child.updatedAt },
          data: { ...deleted, storageVersion: versions.get(child.id) },
        }));
      }
    } else if (descendants.length) {
      children.push(prisma.fileEntry.updateMany({
        where: { id: { in: descendants.map(child => child.id) }, storageNodeId, isDeleted: false },
        data: deleted,
      }));
    }
    await prisma.$transaction([
      ...children,
      prisma.fileEntry.update({
        where: { id: fileEntryId, storageNodeId, relativePath: entry.relativePath, isDeleted: false, updatedAt: current.updatedAt },
        data: { ...deleted, storageVersion: versions.get(fileEntryId) },
      }),
      prisma.shareLink.updateMany({
        where: { id: { in: affectedShareIds }, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await auditUserAction(
      session.userId,
      "storage.file_delete",
      {
        entryId: entry.id,
        entryName: entry.name,
        relativePath: entry.relativePath,
        physicalDeleted: false,
        recycleBin: true,
      },
      "INFO",
      session.currentTeamId,
    );

    return {
      success: t("storagePage.action.fileMovedToRecycle", { name: entry.name }),
      physicalDeleted: false,
      needsReconcile: false,
    } satisfies StorageDeleteActionState;
  } catch (error) {
    return {
      error: getErrorMessage(error, t("storagePage.action.fileDeleteFailed")),
    } satisfies StorageDeleteActionState;
  } finally {
    try { await unlockPath?.(); } finally { await release?.(); }
  }
}
