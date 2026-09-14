import { apiCopy } from "@/lib/i18n/api-copy";
import { randomUUID } from "node:crypto";
import { readdir, link, unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { teamWhere } from "@/lib/auth/team-scope";
import type { SessionPayload } from "@/lib/auth/session";
import {
  assertStorageAccess,
  releaseStorageQuotaGuard,
} from "@/lib/storage/access-control";
import {
  copyStorageFile,
  storageFileNodeSelect,
  type StorageFileNode,
} from "@/lib/storage/file-content";
import {
  createManagedFolder,
  deleteBackingObject,
  moveBackingObject,
  resolveManagedLocalEntryPath,
  statBackingObject,
} from "@/lib/storage/fs-backend";
import { createWebDavClient } from "@/lib/storage/webdav-client";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import { normalizeRemoteTargetPath } from "@/lib/storage/remote-path";
import { listRemoteDirectory } from "@/lib/ssh/client";
import {
  normalizeStorageRelativePath,
  normalizeStorageTargetDirectory,
} from "@/lib/storage/path-utils";
import { snapshotFileVersionBeforeOverwrite } from "@/lib/storage/file-versions";
import { tryAcquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { FileOperationUncertainError } from "./operation-schema";

export type ConflictPolicy = "skip" | "rename" | "overwrite";
type CopyItem = { path: string; directory: boolean };

export function copyCandidateName(
  name: string,
  index: number,
  directory: boolean,
) {
  if (!index) return name;
  const ext = directory ? "" : path.posix.extname(name);
  return `${ext ? name.slice(0, -ext.length) : name} (${index})${ext}`;
}

async function listChildren(
  node: StorageFileNode,
  relativePath: string,
): Promise<CopyItem[]> {
  if (node.driver === "LOCAL") {
    const resolved = await resolveManagedLocalEntryPath({
      basePath: node.basePath,
      relativePath,
    });
    const entries = await readdir(resolved.absolutePath, {
      withFileTypes: true,
    });
    return entries.map((entry) => {
      if (!entry.isDirectory() && !entry.isFile())
        throw new Error(
          apiCopy("apiCopy.files.op.special", { v0: entry.name }),
        );
      return {
        path: `${relativePath}/${entry.name}`,
        directory: entry.isDirectory(),
      };
    });
  }
  if (node.driver === "WEBDAV")
    return (await createWebDavClient(node).list(relativePath)).map((entry) => ({
      path: entry.relativePath,
      directory: entry.isDirectory,
    }));
  if (node.driver === "SFTP") {
    const entries = await listRemoteDirectory({
      ...resolveStorageSshCredentials(node),
      remotePath: normalizeRemoteTargetPath(node.basePath, relativePath),
      maxEntries: 10001,
    });
    return entries.map((entry) => {
      if (!["file", "directory"].includes(entry.type))
        throw new Error(
          apiCopy("apiCopy.files.op.special", { v0: entry.name }),
        );
      return {
        path: `${relativePath}/${entry.name}`,
        directory: entry.type === "directory",
      };
    });
  }
  throw new Error(apiCopy("apiCopy.files.op.driver"));
}

export async function copyFileEntry(input: {
  session: SessionPayload;
  fileEntryId: string;
  targetDir: string;
  policy: ConflictPolicy;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => Promise<void>;
}) {
  const entry = await prisma.fileEntry.findFirst({
    where: {
      id: input.fileEntryId,
      isDeleted: false,
      storageNode: teamWhere(input.session),
    },
    include: { storageNode: { select: storageFileNodeSelect } },
  });
  if (!entry) throw new Error(apiCopy("apiCopy.files.op.missing"));
  const target = normalizeStorageTargetDirectory(input.targetDir);
  if (!target.ok) throw new Error(target.reason);
  const source = normalizeStorageRelativePath(entry.relativePath);
  if (!source.ok) throw new Error(source.reason);
  if (
    entry.entryType === "DIRECTORY" &&
    (target.path === source.path || target.path.startsWith(`${source.path}/`))
  )
    throw new Error(apiCopy("apiCopy.files.op.descendant"));
  const release = await tryAcquireAdvisoryLock(
    "storage-file-operation",
    entry.storageNodeId,
  );
  if (!release) throw new Error(apiCopy("apiCopy.files.op.busy"));
  const node = entry.storageNode;
  let copied = 0;
  try {
    const currentEntry = await prisma.fileEntry.findFirst({
      where: {
        id: entry.id,
        isDeleted: false,
        storageNode: teamWhere(input.session),
      },
      select: { relativePath: true, storageNodeId: true, entryType: true },
    });
    if (
      !currentEntry ||
      currentEntry.relativePath !== entry.relativePath ||
      currentEntry.storageNodeId !== entry.storageNodeId ||
      currentEntry.entryType !== entry.entryType
    )
      throw new Error(apiCopy("apiCopy.files.op.changed"));
    const ensureAccess = async (
      relativePath: string,
      operation: "read" | "write",
    ) => {
      const access = await assertStorageAccess({
        session: input.session,
        storageNodeId: node.id,
        relativePath,
        operation,
      });
      if (!access.allowed)
        throw new Error(access.reason ?? apiCopy("apiCopy.files.op.access"));
    };
    await ensureAccess(source.path, "read");
    const items: CopyItem[] = [
      { path: source.path, directory: entry.entryType === "DIRECTORY" },
    ];
    const deleted = await prisma.fileEntry.findMany({
      where: {
        storageNodeId: node.id,
        isDeleted: true,
        relativePath: { startsWith: `${source.path}/` },
      },
      select: { relativePath: true },
      take: 10001,
    });
    if (deleted.length > 10000)
      throw new Error(apiCopy("apiCopy.files.op.entries"));
    const deletedPaths = new Set(deleted.map((item) => item.relativePath));
    const seen = new Set([source.path]);
    for (let index = 0; index < items.length; index++) {
      input.signal?.throwIfAborted();
      const current = items[index]!;
      await ensureAccess(current.path, "read");
      if (!current.directory) continue;
      if (current.path.split("/").length - source.path.split("/").length >= 64)
        throw new Error(apiCopy("apiCopy.files.op.depth"));
      for (const child of await listChildren(node, current.path)) {
        const normalized = normalizeStorageRelativePath(child.path);
        if (
          !normalized.ok ||
          !child.path.startsWith(`${current.path}/`) ||
          child.path.slice(current.path.length + 1).includes("/")
        )
          throw new Error(apiCopy("apiCopy.files.op.invalid"));
        // Deleted directories are excluded before traversal, so descendants
        // never enter the queue and only exact membership is needed here.
        if (deletedPaths.has(child.path)) continue;
        if (seen.has(child.path))
          throw new Error(apiCopy("apiCopy.files.op.repeated"));
        seen.add(child.path);
        items.push(child);
        if (items.length > 10000)
          throw new Error(apiCopy("apiCopy.files.op.entries"));
      }
    }
    let root = "";
    for (let index = 0; index < 1000; index++) {
      root = [
        target.path,
        copyCandidateName(entry.name, index, entry.entryType === "DIRECTORY"),
      ]
        .filter(Boolean)
        .join("/");
      const normalized = normalizeStorageRelativePath(root);
      if (!normalized.ok) throw new Error(normalized.reason);
      await ensureAccess(root, "write");
      const indexed = await prisma.fileEntry.findUnique({
        where: {
          storageNodeId_relativePath: {
            storageNodeId: node.id,
            relativePath: root,
          },
        },
      });
      const physical = await statBackingObject({
        storageNode: node,
        relativePath: root,
      });
      if (!indexed && !physical) break;
      if (input.policy === "skip")
        return { path: root, skipped: true, copied: 0 };
      if (input.policy === "overwrite") {
        if (root === source.path)
          throw new Error(apiCopy("apiCopy.files.op.same"));
        if (indexed?.isDeleted)
          throw new Error(apiCopy("apiCopy.files.op.trash"));
        break;
      }
      if (index === 999) throw new Error(apiCopy("apiCopy.files.op.names"));
    }
    if (source.path.startsWith(`${root}/`))
      throw new Error(apiCopy("apiCopy.files.op.ancestor"));
    for (const item of items) {
      input.signal?.throwIfAborted();
      const destination = root + item.path.slice(source.path.length);
      await ensureAccess(item.path, "read");
      await ensureAccess(destination, "write");
      const occupant = await prisma.fileEntry.findUnique({
        where: {
          storageNodeId_relativePath: {
            storageNodeId: node.id,
            relativePath: destination,
          },
        },
      });
      if (occupant?.isDeleted)
        throw new Error(
          apiCopy("apiCopy.files.op.trashPath", { v0: destination }),
        );
      if (occupant && (occupant.entryType === "DIRECTORY") !== item.directory)
        throw new Error(apiCopy("apiCopy.files.op.type", { v0: destination }));
      const physical = await statBackingObject({
        storageNode: node,
        relativePath: destination,
      });
      if (item.directory) {
        if (!physical)
          await createManagedFolder({
            storageNode: node,
            relativePath: destination,
          });
        else if (!occupant || input.policy !== "overwrite")
          throw new Error(
            apiCopy("apiCopy.files.op.exists", { v0: destination }),
          );
        await prisma.fileEntry.upsert({
          where: {
            storageNodeId_relativePath: {
              storageNodeId: node.id,
              relativePath: destination,
            },
          },
          create: {
            storageNodeId: node.id,
            relativePath: destination,
            name: path.posix.basename(destination),
            entryType: "DIRECTORY",
            mimeType: "inode/directory",
          },
          update: {},
        });
      } else {
        if ((occupant || physical) && input.policy !== "overwrite")
          throw new Error(
            apiCopy("apiCopy.files.op.exists", { v0: destination }),
          );
        const sourceStat = await statBackingObject({
          storageNode: node,
          relativePath: item.path,
        });
        if (!sourceStat)
          throw new Error(
            apiCopy("apiCopy.files.op.sourceMissing", { v0: item.path }),
          );
        const access = await assertStorageAccess({
          session: input.session,
          storageNodeId: node.id,
          relativePath: destination,
          operation: "write",
          writeBytes: sourceStat.size,
        });
        if (!access.allowed)
          throw new Error(access.reason ?? apiCopy("apiCopy.files.op.quota"));
        const parent = path.posix.dirname(destination);
        const stage = path.posix.join(parent, `.vch-copy-${randomUUID()}`);
        const backup = path.posix.join(parent, `.vch-backup-${randomUUID()}`);
        let backedUp = false;
        let promoted = false;
        let remotePromotionAttempted = false;
        try {
          const result = await copyStorageFile(node, item.path, stage);
          const afterCopy = await statBackingObject({
            storageNode: node,
            relativePath: item.path,
          });
          if (
            result.size !== sourceStat.size ||
            !afterCopy ||
            afterCopy.size !== sourceStat.size ||
            afterCopy.lastModifiedMs !== sourceStat.lastModifiedMs
          )
            throw new Error(apiCopy("apiCopy.files.op.changed"));
          input.signal?.throwIfAborted();
          if (occupant && physical)
            await snapshotFileVersionBeforeOverwrite({
              fileEntryId: occupant.id,
              userId: input.session.userId,
              reason: "UPLOAD",
            });
          if (physical) {
            await moveBackingObject({
              storageNode: node,
              oldRelativePath: destination,
              newRelativePath: backup,
            });
            backedUp = true;
          }
          if (node.driver === "LOCAL") {
            const stagedPath = await resolveManagedLocalEntryPath({
              basePath: node.basePath,
              relativePath: stage,
            });
            const targetPath = await resolveManagedLocalEntryPath({
              basePath: node.basePath,
              relativePath: destination,
            });
            await link(stagedPath.absolutePath, targetPath.absolutePath);
            promoted = true;
            await unlink(stagedPath.absolutePath);
          } else {
            remotePromotionAttempted = true;
            await moveBackingObject({
              storageNode: node,
              oldRelativePath: stage,
              newRelativePath: destination,
            });
          }
          promoted = true;
          const sourceIndex = await prisma.fileEntry.findUnique({
            where: {
              storageNodeId_relativePath: {
                storageNodeId: node.id,
                relativePath: item.path,
              },
            },
            select: { mimeType: true },
          });
          await prisma.fileEntry.upsert({
            where: {
              storageNodeId_relativePath: {
                storageNodeId: node.id,
                relativePath: destination,
              },
            },
            create: {
              storageNodeId: node.id,
              relativePath: destination,
              name: path.posix.basename(destination),
              entryType: "FILE",
              size: BigInt(result.size),
              mimeType: sourceIndex?.mimeType,
            },
            update: {
              size: BigInt(result.size),
              mimeType: sourceIndex?.mimeType,
              checksumSha256: null,
            },
          });
        } catch (error) {
          try {
            if (
              remotePromotionAttempted &&
              !promoted &&
              (await statBackingObject({
                storageNode: node,
                relativePath: destination,
              }))
            )
              throw new Error(apiCopy("apiCopy.files.op.changed"));
            if (promoted)
              await deleteBackingObject({
                storageNode: node,
                relativePath: destination,
                isDirectory: false,
                tolerateMissing: true,
              });
            // A remote rename may commit before its response is lost. Probe the
            // unique backup path before deciding the old bytes never moved.
            if (
              backedUp ||
              (await statBackingObject({
                storageNode: node,
                relativePath: backup,
              }))
            ) {
              if (
                await statBackingObject({
                  storageNode: node,
                  relativePath: destination,
                })
              )
                throw new Error(
                  apiCopy("apiCopy.files.op.exists", { v0: destination }),
                );
              await moveBackingObject({
                storageNode: node,
                oldRelativePath: backup,
                newRelativePath: destination,
              });
            }
          } catch (recoveryError) {
            throw new FileOperationUncertainError(
              apiCopy("apiCopy.files.op.recovery", {
                v0: backup,
                v1: destination,
                v2: String(recoveryError),
              }),
            );
          }
          throw error;
        } finally {
          await releaseStorageQuotaGuard(access);
          await deleteBackingObject({
            storageNode: node,
            relativePath: stage,
            isDirectory: false,
            tolerateMissing: true,
          }).catch(() => undefined);
        }
        if (backedUp)
          await deleteBackingObject({
            storageNode: node,
            relativePath: backup,
            isDirectory: false,
            tolerateMissing: true,
          }).catch((error) => {
            throw new FileOperationUncertainError(
              apiCopy("apiCopy.files.op.recovery", {
                v0: backup,
                v1: destination,
                v2: String(error),
              }),
            );
          });
      }
      copied++;
      await input.onProgress?.(copied, items.length);
    }
    return { path: root, skipped: false, copied };
  } catch (error) {
    if (copied > 0 && !(error instanceof FileOperationUncertainError))
      throw new FileOperationUncertainError(
        apiCopy("apiCopy.files.op.partial", {
          v0: copied,
          v1: error instanceof Error ? error.message : String(error),
        }),
      );
    throw error;
  } finally {
    await release();
  }
}
