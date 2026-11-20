import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";

/**
 * Serialize every overwrite of one stored file: the text editor (LOCAL and
 * SFTP) and version restore. Each of them checks the current version, keeps
 * the old body as a version, writes, and updates the index; interleaved, one
 * write lands on top of another that already succeeded and the history
 * holds neither. Keyed by node and path, so files without an index row (a
 * remote file edited before it was ever listed) are covered too.
 */
export function lockStorageFileOverwrite(storageNodeId: string, relativePath: string, sourcePath?: string) {
  if (sourcePath !== undefined) {
    // Both names on one connection: an upload cannot replace the source between
    // the no-clobber link and unlink, or while an index failure is rolled back.
    return acquireAdvisoryLock("storage-editable", `${storageNodeId}:${relativePath}`, {
      additionalResourceId: `${storageNodeId}:${sourcePath}`,
    });
  }
  return acquireAdvisoryLock("storage-editable", `${storageNodeId}:${relativePath}`);
}
