import { readdir } from "node:fs/promises";
import { ConflictError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { listRemoteDirectory } from "@/lib/ssh/client";
import { createAgentFileClient } from "./agent-file-client";
import { deleteBackingObject, isMissingBackingObjectError, resolveManagedLocalEntryPath, type StorageNodeWithCredentials } from "./fs-backend";
import { resolveStorageRemotePath } from "./remote-containment";
import { createWebDavClient } from "./webdav-client";

type RecycledMember = { relativePath: string; entryType: string; deletedAgentRoot: string | null; storageVersion: string | null };

export async function deleteRecycledBackingObjects(node: StorageNodeWithCredentials, root: RecycledMember, children: RecycledMember[]) {
  // A descendant's path is always longer than its ancestors' paths.
  const batch = [...children, root].sort((a, b) => b.relativePath.length - a.relativePath.length);
  const paths = new Map(batch.map(member => [member.relativePath, member.entryType]));
  const agent = node.driver === "AGENT";
  if ((agent && !node.id) || batch.some(member => (agent || member.deletedAgentRoot) && (!agent || !root.deletedAgentRoot ||
      member.deletedAgentRoot !== root.deletedAgentRoot || !member.storageVersion))) {
    throw new ConflictError(t("backend.storage.recycledAgentChanged"));
  }
  if (node.driver === "WEBDAV") {
    await createWebDavClient(node).deleteRecycledBatch(root.relativePath, batch);
    return;
  }
  const client = agent && node.id ? createAgentFileClient(node.id, undefined, root.deletedAgentRoot!) : null;
  for (const member of batch) {
    const { relativePath } = member;
    try {
      if (client) {
        const entry = await client.stat(relativePath);
        if (!entry) continue;
        if (entry.etag !== member.storageVersion || entry.isDirectory !== (member.entryType === "DIRECTORY")) {
          throw new ConflictError(t("backend.storage.recycledAgentChanged"));
        }
      }
      if (member.entryType !== "DIRECTORY") continue;
      let entries: { name: string; type: string }[];
      if (client) {
        entries = (await client.list(relativePath)).map(row => ({ name: row.name, type: row.isDirectory ? "DIRECTORY" : "FILE" }));
      } else if (node.driver === "LOCAL") {
        const target = await resolveManagedLocalEntryPath({ basePath: node.basePath, relativePath });
        entries = (await readdir(target.absolutePath, { withFileTypes: true })).map(row =>
          ({ name: row.name, type: row.isDirectory() ? "DIRECTORY" : row.isFile() ? "FILE" : "OTHER" }));
      } else {
        const { credentials, remotePath } = await resolveStorageRemotePath(node, relativePath);
        entries = (await listRemoteDirectory({ ...credentials, remotePath, requireComplete: true })).map(row =>
          ({ name: row.name, type: row.type.toUpperCase() }));
      }
      if (entries.some(row => paths.get(`${relativePath}/${row.name}`) !== row.type)) {
        throw new ConflictError(t("backend.storage.recycledDirectoryConflict"));
      }
    } catch (error) {
      if (!isMissingBackingObjectError(error)) throw error;
    }
  }
  for (const member of batch) {
    const isDirectory = member.entryType === "DIRECTORY";
    // Removing the batch's own children changes a directory's Agent etag.
    // The Agent re-stats it and applies that version to a nonrecursive rmdir.
    await deleteBackingObject({
      storageNode: node, relativePath: member.relativePath, isDirectory, emptyOnly: isDirectory,
      expectedRoot: member.deletedAgentRoot ?? undefined, version: isDirectory ? undefined : member.storageVersion ?? undefined,
      tolerateMissing: true,
    });
  }
}
