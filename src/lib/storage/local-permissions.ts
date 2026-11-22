import { chmod, chown, lstat, stat } from "node:fs/promises";
import path from "node:path";
import { ConflictError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

/** Preserve replacement ownership and permissions. New files inherit directory read/write bits and umask. */
export async function matchTargetMode(stagedPath: string, targetPath: string) {
  if (process.platform === "win32") return;
  const target = await lstat(targetPath).catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (target && !target.isFile()) throw new ConflictError(t("backend.storage.targetIsDirectory"));
  if (target) {
    const staged = await stat(stagedPath);
    if (target.uid !== staged.uid || target.gid !== staged.gid) await chown(stagedPath, target.uid, target.gid);
  }
  const mode = target ? target.mode & 0o777 : (await stat(path.dirname(targetPath))).mode & 0o666 & ~process.umask();
  await chmod(stagedPath, mode);
  if (target) {
    const applied = await stat(stagedPath);
    if (applied.uid !== target.uid || applied.gid !== target.gid || (applied.mode & 0o777) !== mode) {
      throw new ConflictError(t("backend.storage.editableFileChangedOnDisk"));
    }
  }
}
