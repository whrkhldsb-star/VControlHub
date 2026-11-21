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
  const ancestors = new Set<string>();
  for (const target of sourcePath === undefined ? [relativePath] : [relativePath, sourcePath]) {
    for (let slash = target.indexOf("/"); slash >= 0; slash = target.indexOf("/", slash + 1)) {
      ancestors.add(`${storageNodeId}:${target.slice(0, slash)}`);
    }
  }
  // Sibling writes can proceed together. Taking the ancestor shared locks on
  // this connection makes directory deletes exclusive with descendant writes.
  return acquireAdvisoryLock("storage-editable", `${storageNodeId}:${relativePath}`, {
    additionalResourceId: sourcePath === undefined ? undefined : `${storageNodeId}:${sourcePath}`,
    sharedResourceIds: [...ancestors],
  });
}
