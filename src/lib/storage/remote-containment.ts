import path from "node:path";

import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { resolveRemoteRealPath, type SshConnectionParams } from "@/lib/ssh/client";

import { normalizeRemotePath, normalizeRemoteTargetPath } from "./remote-path";
import {
  resolveStorageSshCredentials,
  type ResolvedStorageSshCredentials,
  type StorageSshCredentialNode,
} from "./ssh-credentials";

/**
 * Physical containment for SFTP storage nodes.
 *
 * normalizeRemotePath only contains a path lexically. The SSH account behind a
 * storage node can usually read and write far more than the node's basePath,
 * and SFTP/the Agent follow symlinks, so a link anywhere below the root
 * (`docs/link -> /etc`) would hand a storage user whatever that account can
 * reach. A link to a sibling directory inside the root would likewise bypass
 * path grants, which are checked on the lexical path.
 *
 * Rule: the canonical (symlink-free) remote path must equal the node's
 * canonical root joined with the lexical relative path. The root itself may be
 * a link; below it, no symlink hop is followed. For a path that does not exist
 * yet, the deepest existing ancestor is resolved (a dangling link refuses).
 * Callers operate on the returned canonical path.
 *
 * Limit: this is a check, then an operation over a separate SFTP request. A
 * party with shell access to the remote account can swap a directory for a
 * link in between; SFTP has no openat/O_NOFOLLOW chain to rule that out.
 * Storage users cannot create links through the platform (archive extraction
 * refuses archives with links), so the remaining window needs a concurrent
 * change by someone who already controls the remote account.
 */
export async function assertRemotePathContained(
  connection: SshConnectionParams,
  basePath: string,
  lexicalPath: string,
): Promise<string> {
  const lexicalRoot = normalizeRemotePath(basePath);
  const relative = lexicalPath === lexicalRoot ? "" : path.posix.relative(lexicalRoot, lexicalPath);
  // Segment-wise: a name that merely begins with two dots (`..cache`) is fine.
  if (relative === ".." || relative.startsWith("../") || path.posix.isAbsolute(relative)) {
    throw new ValidationError(t("backend.storage.pathExceedsNodeRoot"));
  }
  const realRoot = await resolveRemoteRealPath({ ...connection, remotePath: lexicalRoot });
  const realTarget = relative
    ? await resolveRemoteRealPath({ ...connection, remotePath: lexicalPath })
    : realRoot;
  const expected = relative ? path.posix.join(portable(realRoot), relative) : portable(realRoot);
  const actual = portable(realTarget);
  const windows = /^\/[a-z]:\//i.test(expected);
  if ((windows ? actual.toLowerCase() : actual) !== (windows ? expected.toLowerCase() : expected)) {
    throw new ValidationError(t("backend.storage.remotePathLeavesNodeRoot"));
  }
  return realTarget;
}

/** Windows OpenSSH reports C:/... or C:\\...; compare as /C:/... */
function portable(value: string) {
  const slashes = value.replace(/\\/g, "/");
  const absolute = /^[a-z]:\//i.test(slashes) ? `/${slashes}` : slashes;
  return path.posix.normalize(absolute).replace(/\/+$/, "") || "/";
}

/**
 * Lexical normalization + credentials + physical containment for one storage
 * path. `allowRoot` permits the node root itself (listing, sync start).
 */
export async function resolveStorageRemotePath(
  node: StorageSshCredentialNode & { basePath: string },
  relativePath: string | null | undefined,
  options: { allowRoot?: boolean; credentials?: ResolvedStorageSshCredentials } = {},
): Promise<{ remotePath: string; credentials: ResolvedStorageSshCredentials }> {
  const lexical = options.allowRoot
    ? normalizeRemotePath(node.basePath, relativePath)
    : normalizeRemoteTargetPath(node.basePath, relativePath);
  const credentials = options.credentials ?? resolveStorageSshCredentials(node);
  const remotePath = await assertRemotePathContained(credentials, node.basePath, lexical);
  return { remotePath, credentials };
}
