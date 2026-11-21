// On an offline installation, keep each overwritten file on its original
// filesystem until the app and history overlays have both succeeded.
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

async function existing(target) {
  return fs.lstat(target).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

export async function applyFileOverlays(overlays) {
  const changes = [];
  async function ensureDirectory(target) {
    const info = await existing(target);
    if (info?.isDirectory()) return;
    if (info) throw new Error(`Restore target is not a directory: ${target}`);
    await ensureDirectory(path.dirname(target));
    await fs.mkdir(target);
    changes.push({ target, directory: true });
  }

  async function copyDirectory(source, destination) {
    await ensureDirectory(destination);
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
      const file = path.join(source, entry.name);
      const target = path.join(destination, entry.name);
      if (entry.isDirectory()) {
        await copyDirectory(file, target);
        continue;
      }
      const previous = await existing(target);
      if (!entry.isFile() || (previous && !previous.isFile())) throw new Error(`Cannot overwrite a non-regular restore target: ${target}`);
      let saved = null;
      if (previous) {
        saved = path.join(destination, `.vch-restore-${randomUUID()}`);
        await fs.rename(target, saved);
      }
      changes.push({ target, saved });
      await fs.copyFile(file, target, fs.constants.COPYFILE_EXCL);
    }
  }

  try {
    for (const { source, destination } of overlays) await copyDirectory(source, destination);
  } catch (error) {
    const failures = [];
    for (const { target, saved, directory } of changes.reverse()) {
      try {
        if (directory) await fs.rmdir(target);
        else {
          await fs.rm(target, { force: true });
          if (saved) await fs.rename(saved, target);
        }
      } catch (rollbackError) {
        failures.push(`${target}: ${rollbackError.message}`);
      }
    }
    if (failures.length) throw new Error(`File rollback incomplete after ${error.message}: ${failures.join(", ")}`);
    throw error;
  }
  for (const { saved } of changes) if (saved) await fs.unlink(saved);
}
