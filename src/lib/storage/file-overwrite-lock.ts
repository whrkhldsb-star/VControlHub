import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";

/**
 * Serialize every overwrite of one stored file: the text editor (LOCAL and
 * SFTP) and version restore. Each of them checks the current version, keeps
 * the old body as a version, writes, and updates the index; interleaved, one
 * write lands on top of another that already succeeded and the history
 * holds neither. Keyed by node and path, so files without an index row (a
 * remote file edited before it was ever listed) are covered too.
 */
export function lockStorageFileOverwrite(storageNodeId: string, relativePath: string) {
  return acquireAdvisoryLock("storage-editable", `${storageNodeId}:${relativePath}`);
}
