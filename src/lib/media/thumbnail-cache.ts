/**
 * On-disk cache for generated media thumbnails.
 *
 * `/api/media/[id]/thumbnail` writes one `<sha1>.jpg` per (item, size,
 * updatedAt, path) tuple. Nothing ever removed those files: the key is a
 * one-way hash, so a deleted media item cannot be mapped back to its
 * thumbnail, and re-uploading an item mints a new key while orphaning the old
 * one. Left alone the directory grows forever — and its default location is
 * `os.tmpdir()`, which on many hosts is a tmpfs, so the leak lands in RAM.
 *
 * The cache is disposable by construction (a miss just regenerates), so the
 * prune is a plain age + count sweep driven by the maintenance worker.
 */
import { readdir, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { config } from "@/lib/config/env";
import { createLogger } from "@/lib/logging";

const logger = createLogger("media-thumbnail-cache");

/** Files older than this are dropped regardless of how many there are. */
export const THUMBNAIL_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Hard ceiling on retained files; the oldest are dropped first. */
export const THUMBNAIL_CACHE_MAX_ENTRIES = 20_000;

export function thumbnailCacheRoot(): string {
  return (
    config.media.thumbCacheDir ??
    path.join(os.tmpdir(), "vcontrolhub-thumbnails")
  );
}

async function safeUnlink(filePath: string): Promise<boolean> {
  try {
    await unlink(filePath);
    return true;
  } catch {
    // Another request may have replaced or removed it — a miss just regenerates.
    return false;
  }
}

export async function pruneThumbnailCache(options?: {
  maxAgeMs?: number;
  maxEntries?: number;
  now?: number;
}): Promise<{ deleted: number; retained: number }> {
  const maxAgeMs = options?.maxAgeMs ?? THUMBNAIL_CACHE_MAX_AGE_MS;
  const maxEntries = options?.maxEntries ?? THUMBNAIL_CACHE_MAX_ENTRIES;
  const now = options?.now ?? Date.now();
  const root = thumbnailCacheRoot();

  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    // Never generated a thumbnail yet (or the dir was wiped) — nothing to do.
    return { deleted: 0, retained: 0 };
  }

  const surviving: Array<{ filePath: string; mtimeMs: number }> = [];
  let deleted = 0;
  for (const name of names) {
    // Only touch what this cache writes; never recurse into foreign entries.
    if (!name.endsWith(".jpg")) continue;
    const filePath = path.join(root, name);
    let info;
    try {
      info = await stat(filePath);
    } catch {
      continue;
    }
    if (!info.isFile()) continue;
    if (now - info.mtimeMs > maxAgeMs) {
      if (await safeUnlink(filePath)) deleted += 1;
      continue;
    }
    surviving.push({ filePath, mtimeMs: info.mtimeMs });
  }

  if (surviving.length > maxEntries) {
    surviving.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const entry of surviving.splice(0, surviving.length - maxEntries)) {
      if (await safeUnlink(entry.filePath)) deleted += 1;
    }
  }

  if (deleted > 0) {
    logger.info("pruned media thumbnail cache", {
      root,
      deleted,
      retained: surviving.length,
    });
  }
  return { deleted, retained: surviving.length };
}
