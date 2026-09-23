import { apiCopy } from "@/lib/i18n/api-copy";
import { randomUUID } from "node:crypto";
import { readdir, link, unlink, lstat, rmdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { teamWhere } from "@/lib/auth/team-scope";
import type { SessionPayload } from "@/lib/auth/session";
import {
  assertStorageAccess,
  getStorageAccessCapabilities,
  getStorageAccessCapabilityKey,
  releaseStorageQuotaGuard,
} from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
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

/**
 * Per-directory name index for LOCAL nodes: one `readdir` per distinct parent
 * directory answers "does this path exist?" for every candidate/destination
 * inside it, replacing one lstat (or one remote stat round-trip) per path —
 * the destination-probe loop alone could stat the same directory hundreds of
 * times. Listings are loaded lazily and cached; a path is only ever probed
 * before the copy creates that exact name, and names within one copy are
 * unique, so cache staleness cannot flip an answer.
 */
class LocalExistenceIndex {
  private readonly dirs = new Map<string, Promise<Set<string>>>();

  constructor(private readonly node: StorageFileNode) {}

  exists(relativePath: string): Promise<boolean> {
    const dir = path.posix.dirname(relativePath);
    let names = this.dirs.get(dir);
    if (!names) {
      names = this.loadDir(dir);
      this.dirs.set(dir, names);
    }
    return names.then((set) => set.has(path.posix.basename(relativePath)));
  }

  private async loadDir(relativeDir: string): Promise<Set<string>> {
    const resolved = await resolveManagedLocalEntryPath({
      basePath: this.node.basePath,
      relativePath: relativeDir,
    });
    try {
      return new Set(await readdir(resolved.absolutePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return new Set();
      }
      throw error;
    }
  }
}

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
        throw new Error(storageAccessDeniedCopy(access.reason));
    };
    // Batched pre-flight: ONE capabilities lookup covers a whole set of paths
    // instead of one assertStorageAccess round-trip (node lookup + paged
    // grants) per path. Quota-bearing writes still go through
    // assertStorageAccess individually — capability checks cannot serialize
    // quota against concurrent writers.
    const ensureAccessBatched = async (
      targets: Array<{ path: string; operation: "read" | "write" }>,
    ) => {
      if (targets.length === 0) return;
      const capabilities = await getStorageAccessCapabilities({
        session: input.session,
        targets: targets.map((target) => ({
          storageNodeId: node.id,
          relativePath: target.path,
        })),
      });
      for (const target of targets) {
        const key = getStorageAccessCapabilityKey({
          storageNodeId: node.id,
          relativePath: target.path,
        });
        const capability = key ? capabilities.get(key) : undefined;
        const allowed =
          target.operation === "read"
            ? capability?.canRead
            : capability?.canWrite;
        if (!allowed) throw new Error(storageAccessDeniedCopy());
      }
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
      if (!current.directory) continue;
      if (current.path.split("/").length - source.path.split("/").length >= 64)
        throw new Error(apiCopy("apiCopy.files.op.depth"));
      // `current` entered `items` only after its own read access was verified
      // (the source root is checked above), so listing it is authorized.
      const accepted: CopyItem[] = [];
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
        accepted.push(child);
      }
      // ONE capabilities lookup authorizes every child discovered in this
      // directory before any of them is listed or queued.
      await ensureAccessBatched(
        accepted.map((child) => ({
          path: child.path,
          operation: "read" as const,
        })),
      );
      items.push(...accepted);
      if (items.length > 10000)
        throw new Error(apiCopy("apiCopy.files.op.entries"));
    }
    // Existence probing for candidate/destination paths. On LOCAL one readdir
    // per distinct parent directory replaces one stat per path; remote
    // drivers keep the per-path stat (each is a round-trip on a pooled
    // connection).
    const localExistence = node.driver === "LOCAL"
      ? new LocalExistenceIndex(node)
      : null;
    const physicalExists = (relativePath: string): Promise<boolean> =>
      localExistence
        ? localExistence.exists(relativePath)
        : statBackingObject({ storageNode: node, relativePath }).then(
            (stat) => stat !== null,
          );
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
      const indexed = await prisma.fileEntry.findUnique({
        where: {
          storageNodeId_relativePath: {
            storageNodeId: node.id,
            relativePath: root,
          },
        },
      });
      const physical = await physicalExists(root);
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
    const destinations = items.map((item) => root + item.path.slice(source.path.length));
    // ONE batched pre-flight for the chosen root, every source read, and
    // every destination write — the loop below previously ran two
    // assertStorageAccess round-trips per item.
    await ensureAccessBatched([
      { path: root, operation: "write" },
      ...items.map((item) => ({ path: item.path, operation: "read" as const })),
      ...destinations.map((destination) => ({
        path: destination,
        operation: "write" as const,
      })),
    ]);
    // Prefetch every indexed occupant in one paged query instead of one
    // findUnique per destination.
    const occupantRows: Array<{
      id: string;
      relativePath: string;
      entryType: string;
      isDeleted: boolean;
    }> = [];
    for (let offset = 0; offset < destinations.length; offset += 500) {
      const page = await prisma.fileEntry.findMany({
        where: {
          storageNodeId: node.id,
          relativePath: { in: destinations.slice(offset, offset + 500) },
        },
        select: { id: true, relativePath: true, entryType: true, isDeleted: true },
      });
      occupantRows.push(...page);
    }
    const occupantsByPath = new Map(
      occupantRows.map((row) => [row.relativePath, row]),
    );
    for (const item of items) {
      input.signal?.throwIfAborted();
      const destination = root + item.path.slice(source.path.length);
      const occupant = occupantsByPath.get(destination);
      if (occupant?.isDeleted)
        throw new Error(
          apiCopy("apiCopy.files.op.trashPath", { v0: destination }),
        );
      if (occupant && (occupant.entryType === "DIRECTORY") !== item.directory)
        throw new Error(apiCopy("apiCopy.files.op.type", { v0: destination }));
      const physical = await physicalExists(destination);
      if (item.directory) {
        let createdIdentity: { dev: number; ino: number } | undefined;
        let creationAttempted = false;
        let created = false;
        try {
          if (!physical) {
            creationAttempted = true;
            await createManagedFolder({
              storageNode: node,
              relativePath: destination,
            });
            created = true;
            if (node.driver === "LOCAL") {
              const resolved = await resolveManagedLocalEntryPath({ basePath: node.basePath, relativePath: destination });
              createdIdentity = await lstat(resolved.absolutePath);
            }
          } else if (!occupant || input.policy !== "overwrite")
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
        } catch (error) {
          if (creationAttempted && node.driver !== "LOCAL") {
            // Remote mkdir/DB responses may be lost after commit. Never use a
            // recursive delete to compensate a directory that could have changed.
            throw new FileOperationUncertainError(apiCopy("apiCopy.files.op.directoryUnconfirmed", { v0: destination, v1: String(error) }));
          }
          if (created) {
            try {
              const indexed = await prisma.fileEntry.findUnique({
                where: { storageNodeId_relativePath: { storageNodeId: node.id, relativePath: destination } },
                select: { id: true },
              });
              if (indexed) throw new Error(apiCopy("apiCopy.files.op.changed"));
              const resolved = await resolveManagedLocalEntryPath({ basePath: node.basePath, relativePath: destination });
              const current = await lstat(resolved.absolutePath);
              if (!createdIdentity || current.dev !== createdIdentity.dev || current.ino !== createdIdentity.ino)
                throw new Error(apiCopy("apiCopy.files.op.changed"));
              // rmdir only removes an empty directory: preserve any new contents.
              await rmdir(resolved.absolutePath);
            } catch (recoveryError) {
              throw new FileOperationUncertainError(apiCopy("apiCopy.files.op.directoryUnconfirmed", { v0: destination, v1: String(recoveryError) }));
            }
          }
          throw error;
        }
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
          throw new Error(storageAccessDeniedCopy(access.reason));
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
