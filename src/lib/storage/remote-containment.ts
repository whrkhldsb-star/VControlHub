import type { Client } from "ssh2";
import path from "node:path";

import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { RemoteDanglingLinkError, resolveRemoteRealPath, type SshConnectionParams } from "@/lib/ssh/client";

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
export async function resolveRemoteContainment(
  connection: SshConnectionParams & { windowsOpenSsh?: boolean },
  basePath: string,
  lexicalPath: string,
  client?: Client,
) {
  const lexicalRoot = normalizeRemotePath(basePath);
  const relative = lexicalPath === lexicalRoot ? "" : path.posix.relative(lexicalRoot, lexicalPath);
  // Segment-wise: a name that merely begins with two dots (`..cache`) is fine.
  if (relative === ".." || relative.startsWith("../") || path.posix.isAbsolute(relative)) {
    throw new ValidationError(t("backend.storage.pathExceedsNodeRoot"));
  }
  // Existing read targets can be resolved on the pinned transfer connection.
  const resolve = client
    ? (remotePath: string) => new Promise<string>((done, reject) => client.sftp((err, sftp) => {
        if (err) return reject(err);
        sftp.realpath(remotePath, (error, value) => {
          sftp.end();
          if (error) reject(error);
          else done(value);
        });
      }))
    : (remotePath: string) => resolveRemoteRealPath({ ...connection, remotePath });
  const realRoot = await resolve(lexicalRoot);
  const realTarget = relative
    ? await resolve(lexicalPath).catch((error: unknown) => {
        // Where the link would lead cannot be known: refuse like a link out of the root.
        if (error instanceof RemoteDanglingLinkError) throw new ValidationError(t("backend.storage.remotePathLeavesNodeRoot"));
        throw error;
      })
    : realRoot;
  const windows = connection.windowsOpenSsh === true;
  const root = physicalPath(realRoot, windows);
  const expected = relative ? path.posix.join(root, windows ? relative.toLowerCase() : relative) : root;
  if (physicalPath(realTarget, windows) !== expected) {
    throw new ValidationError(t("backend.storage.remotePathLeavesNodeRoot"));
  }
  return { target: realTarget, root: realRoot };
}

export async function assertRemotePathContained(
  connection: SshConnectionParams & { windowsOpenSsh?: boolean },
  basePath: string,
  lexicalPath: string,
  client?: Client,
): Promise<string> {
  return (await resolveRemoteContainment(connection, basePath, lexicalPath, client)).target;
}

/** Windows OpenSSH reports C:/... or C:\\...; compare as /C:/... */
function physicalPath(value: string, windows: boolean) {
  if (windows) {
    value = value.replace(/\\/g, "/").toLowerCase();
    if (/^[a-z]:\//.test(value)) value = `/${value}`;
  }
  return path.posix.normalize(value).replace(/\/+$/, "") || "/";
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
