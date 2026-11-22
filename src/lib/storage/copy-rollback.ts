import { ConflictError } from "@/lib/errors";
import { apiCopy } from "@/lib/i18n/api-copy";
import { localPathVersion, removeLocalVersion } from "./local-identity";
import { createAgentFileClient } from "./agent-file-client";
import { createWebDavClient } from "./webdav-client";
import type { StorageNodeWithCredentials } from "./fs-backend";

export async function copyVersion(node: StorageNodeWithCredentials, relativePath: string) {
  if (node.driver === "LOCAL") return localPathVersion(node.basePath, relativePath);
  if (node.driver === "WEBDAV") return (await createWebDavClient(node).stat(relativePath, true))?.etag ?? null;
  if (node.driver === "AGENT" && node.id) return (await createAgentFileClient(node.id).stat(relativePath))?.etag ?? null;
  // SFTP v3 supplies neither inode nor a conditional unlink operation.
  return null;
}

export async function rollbackPublishedCopy(node: StorageNodeWithCredentials, target: string, version: string | null) {
  const changed = () => new ConflictError(apiCopy("apiCopy.files.op.changed"));
  if (!version) throw changed();
  if (node.driver === "WEBDAV") return createWebDavClient(node).delete(target, version);
  if (node.driver === "AGENT" && node.id) return createAgentFileClient(node.id).delete(target, false, version);
  if (node.driver !== "LOCAL") throw changed();
  await removeLocalVersion(node.basePath, target, version);
}
