import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { ConflictError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { createRemoteStorageClient } from "./agent-file-client";
import type { StorageFileNode } from "./file-content";
import { resolveStorageRemotePath } from "./remote-containment";
import { statBackingObject } from "./fs-backend";
import { expandStorageBasePath } from "./path-utils";
import { localRootIdentity, localPathVersion } from "./local-identity";

export type UploadTarget = { root: string; version: string | null };
export async function captureUploadTarget(node: StorageFileNode, relativePath: string, initialize = false): Promise<UploadTarget> {
  const fields = [node.driver, node.basePath, node.teamId, node.serverId, node.host ?? node.server?.host,
    node.port ?? node.server?.port, node.username ?? node.server?.username, node.hostKeySha256 ?? node.server?.hostKeySha256,
    node.webdavConfigEncrypted, node.agentFileShare?.rootIdentity];
  let version: string | null;
  if (node.driver === "LOCAL") {
    if (initialize) await mkdir(expandStorageBasePath(node.basePath), { recursive: true });
    fields.push(await localRootIdentity(node.basePath));
    version = await localPathVersion(node.basePath, relativePath);
  } else if (node.driver === "WEBDAV" || node.driver === "AGENT") {
    const entry = await createRemoteStorageClient({ ...node, expectedRoot: node.agentFileShare?.rootIdentity ?? undefined }).stat(relativePath, true);
    if (entry && (!entry.etag || entry.isDirectory)) throw new ConflictError(t("backend.storage.editableFileChangedOnDisk"));
    version = entry?.etag ?? null;
  } else {
    fields.push((await resolveStorageRemotePath(node, "", { allowRoot: true })).remotePath);
    const entry = await statBackingObject({ storageNode: node, relativePath });
    if (entry?.isDirectory) throw new ConflictError(t("backend.storage.targetIsDirectory"));
    version = entry ? [entry.size, entry.lastModifiedMs].join(":") : null;
  }
  return { root: createHash("sha256").update(JSON.stringify(fields)).digest("hex"), version };
}
