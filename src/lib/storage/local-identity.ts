import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { renameLocalExclusive } from "@/lib/ssh/rename-exclusive";
import { apiCopy } from "@/lib/i18n/api-copy";
import { lstat, realpath, stat, unlink, rmdir } from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import { ConflictError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { expandStorageBasePath, resolveStoragePathWithinBase } from "./path-utils";

const digest = (fields: unknown[]) => createHash("sha256").update(fields.map(String).join("\0")).digest("hex");

export async function localRootIdentity(basePath: string) {
  const root = await realpath(expandStorageBasePath(basePath)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (root === null) return "local:absent";
  const info = await stat(root, { bigint: true });
  if (!info.isDirectory()) throw new ValidationError(t("backend.storage.pathExceedsRoot"));
  return "local:" + digest([root, info.dev, info.ino, info.birthtimeNs]);
}

// Rename changes ctime, and removing a batch member changes its parent's mtime.
export function localObjectVersion(info: BigIntStats) {
  if (!info.isFile() && !info.isDirectory()) throw new ConflictError(t("backend.storage.editableFileChangedOnDisk"));
  return digest([info.dev, info.ino, info.birthtimeNs, ...(info.isFile() ? [info.size, info.mtimeNs] : [])]);
}

export async function localPathVersion(basePath: string, relativePath: string) {
  const target = resolveStoragePathWithinBase(basePath, relativePath);
  if (!target.ok) throw new ValidationError(target.reason);
  try { return localObjectVersion(await lstat(target.path, { bigint: true })); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Verify a private name after moving the object. A new occupant of its public name is never unlinked. */
export async function withMovedLocalVersion(target: string, version: string, operation: (held: string) => Promise<void>) {
  const held = path.join(path.dirname(target), ".vch-backup-" + randomUUID());
  const changed = () => new ConflictError(t("backend.storage.editableFileChangedOnDisk"));
  const initial = localObjectVersion(await lstat(target, { bigint: true }));
  if (initial !== version) throw changed();
  await renameLocalExclusive(target, held);
  try {
    if (localObjectVersion(await lstat(held, { bigint: true })) !== version) throw changed();
    await operation(held);
  } catch (error) {
    try { await renameLocalExclusive(held, target); }
    catch { throw new ConflictError(apiCopy("apiCopy.files.op.recovery", { v0: held, v1: target, v2: changed().message }), { recoveryRequired: true }); }
    throw error;
  }
}

export async function removeLocalVersion(basePath: string, relativePath: string, version: string, directory = false) {
  const target = resolveStoragePathWithinBase(basePath, relativePath);
  if (!target.ok) throw new ValidationError(target.reason);
  await withMovedLocalVersion(target.path, version, directory ? rmdir : unlink);
}
