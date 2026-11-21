import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, open, rm, statfs } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { request } from "undici";
import { loadExecutionActor, executionRefusal } from "@/lib/auth/execution-actor";
import { prisma } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { notifyDownloadResult } from "@/lib/notification/service";
import { relayTempDir } from "@/lib/runtime/platform-paths";
import { assertStorageAccess, largestAllowedWrite, releaseStorageQuotaGuard, type StorageWriteCapacity } from "@/lib/storage/access-control";
import { createAgentFileClient } from "@/lib/storage/agent-file-client";
import { assertNotRecycled } from "@/lib/storage/archive-access";
import { lockStorageFileOverwrite } from "@/lib/storage/file-overwrite-lock";
import { snapshotFileVersionBeforeOverwrite } from "@/lib/storage/file-versions";
import { downloadNotificationSource, deriveDownloadFileNameFromUrl, getPublicDownloadError, indexDownloadedFileEntry, normalizeDownloadFileName } from "./helpers";
import { pinnedDownloadAgent, resolveDownloadRedirects } from "./redirect-chain";
import { getDownloadTargetRelativePath } from "./target-path";
import { hashTransferFile, parseTransferManifest, type TransferManifest } from "./transfer-manifest";

type Destination = { taskId: string; serverId: string; nodeId: string; targetPath: string; signal?: AbortSignal };

export async function publishAgentDownloadFile(input: Destination & { localPath: string; file: TransferManifest["files"][number] }) {
  const { taskId, nodeId, file, signal } = input;
  const relativePath = getDownloadTargetRelativePath("/", path.posix.join(input.targetPath, file.name));
  const where = { id: taskId, agentStorageNodeId: nodeId, serverId: input.serverId, status: "RUNNING" as const };
  const task = await prisma.downloadTask.findFirstOrThrow({ where, select: { createdBy: true, teamId: true, agentRootIdentity: true } });
  if (!task.agentRootIdentity) throw new BusinessError(t("backend.fileAgent.unavailable"));
  const actor = await loadExecutionActor(task.createdBy, task.teamId);
  const verify = async () => {
    signal?.throwIfAborted();
    if (!await prisma.downloadTask.count({ where })) throw new Error("Inactive download");
    const refusal = await executionRefusal({ createdBy: task.createdBy, teamId: task.teamId,
      permission: "storage:write", serverIds: [input.serverId], writesTo: { storageNodeId: nodeId, relativePath } });
    if (refusal) throw new BusinessError(refusal);
    await assertNotRecycled(nodeId, relativePath);
  };
  if (!actor) throw new BusinessError(t("backend.execution.ownerInactive"));
  const access = await assertStorageAccess({ session: actor, storageNodeId: nodeId, relativePath, operation: "write", writeBytes: file.size });
  if (!access.allowed) throw new BusinessError(t("backend.execution.storageRevoked"));
  try {
    const unlock = await lockStorageFileOverwrite(nodeId, relativePath);
    try {
      await verify();
      const client = createAgentFileClient(nodeId, input.serverId, task.agentRootIdentity);
      const existing = await client.stat(relativePath);
      if (existing?.isDirectory) throw new BusinessError(t("backend.storage.targetIsDirectory"));
      const occupant = await prisma.fileEntry.findUnique({ where: { storageNodeId_relativePath: { storageNodeId: nodeId, relativePath } } });
      if (occupant?.entryType === "DIRECTORY") throw new BusinessError(t("backend.storage.targetIsDirectory"));
      if (!existing || !await client.matches(relativePath, file.size, file.sha256, existing)) {
        if (occupant) await snapshotFileVersionBeforeOverwrite({ fileEntryId: occupant.id, userId: actor.userId, reason: "UPLOAD" });
        await client.writeLocal(relativePath, input.localPath, file.sha256, verify);
      }
      await prisma.$transaction(async tx => {
        const binding = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM agent_file_shares WHERE "storageNodeId" = ${nodeId}
            AND "serverId" = ${input.serverId} AND "rootIdentity" = ${task.agentRootIdentity} FOR SHARE`;
        if (!binding.length) throw new BusinessError(t("backend.fileAgent.unavailable"));
        await indexDownloadedFileEntry({ storageNode: { id: nodeId, basePath: "/" },
        targetPath: path.posix.dirname("/" + relativePath), fileName: path.posix.basename(relativePath), size: file.size }, tx);
      });
    } finally { await unlock(); }
  } finally { await releaseStorageQuotaGuard(access); }
}

type HttpDownload = Destination & {
  publishSftp?: (localPath: string, file: TransferManifest["files"][number], signal: AbortSignal) => Promise<void>;
  url: string; fileName?: string | null; limits?: StorageWriteCapacity; maxSpeedKb?: number | null;
};
/** Stream from the validated address for HTTP and HTTPS. Undici request follows no redirects. */
async function fetchToDisk(input: HttpDownload, name: string, localPath: string, active: AbortSignal) {
  const source = await resolveDownloadRedirects(input.url);
  if (!source.ok) throw new BusinessError(source.reason);
  if (!source.resolution) throw new Error("Missing HTTP source");
  const dispatcher = pinnedDownloadAgent(source.resolution);
  let size = 0;
  const hash = createHash("sha256");
  try {
    const response = await request(source.url, { dispatcher, method: "GET", signal: active });
    if (response.statusCode !== 200) {
      response.body.on("error", () => {});
      response.body.destroy();
      throw new Error("Download source did not return a file");
    }
    const limit = input.limits ? largestAllowedWrite(input.limits) : null;
    const disk = await statfs(path.dirname(localPath));
    const reserve = 5 * 1024 ** 3;
    let room = disk.bavail * disk.bsize - reserve;
    const started = Date.now();
    let lastReport = 0;
    const dest = await open(localPath, "wx", 0o600);
    try {
      for await (const bytes of response.body) {
        size += bytes.length;
        if (size > room) throw new BusinessError(t("backend.downloads.relayDiskInsufficient"));
        if (limit !== null && BigInt(size) > limit) throw new BusinessError(t("backend.downloads.storageLimitExceeded"));
        await dest.writeFile(bytes);
        hash.update(bytes);
        if (Date.now() - lastReport >= 1500) {
          const stored = await prisma.downloadTask.updateMany({ where: { id: input.taskId, agentStorageNodeId: input.publishSftp ? null : input.nodeId, status: "RUNNING" }, data: { completedBytes: String(size) } });
          if (!stored.count) throw new Error("Inactive download");
          lastReport = Date.now();
          const remaining = await statfs(path.dirname(localPath));
          room = size + remaining.bavail * remaining.bsize - reserve;
        }
        if (input.maxSpeedKb) {
          const wait = started + size * 1000 / (input.maxSpeedKb * 1024) - Date.now();
          if (wait > 0) await delay(wait, undefined, { signal: active });
        }
      }
    } finally { await dest.close(); }
  } finally { await dispatcher.destroy(); }
  return { name, size, sha256: hash.digest("hex") };
}

export async function receiveAgentHttpDownload(input: HttpDownload) {
  const { taskId, signal } = input;
  const where = { id: taskId, agentStorageNodeId: input.publishSftp ? null : input.nodeId, serverId: input.serverId, status: "RUNNING" as const };
  const claimed = await prisma.downloadTask.updateMany({ where: { ...where, status: { in: ["RUNNING", "PENDING"] } },
    data: { status: "RUNNING", progress: t("backend.downloads.progress.downloading") } });
  if (!claimed.count) return;
  const task = await prisma.downloadTask.findUniqueOrThrow({ where: { id: taskId }, select: { createdBy: true, teamId: true, transferManifest: true, agentRootIdentity: true } });
  const root = relayTempDir(taskId);
  let dir: string | undefined;
  let journaled = task.transferManifest !== null;
  let completed = false;
  try {
    const previous = parseTransferManifest(task.transferManifest);
    if (!input.publishSftp && (!task.agentRootIdentity || (previous && previous.agentRootIdentity !== task.agentRootIdentity))) {
      throw new BusinessError(t("backend.fileAgent.unavailable"));
    }
    const name = normalizeDownloadFileName(input.fileName ?? deriveDownloadFileNameFromUrl(input.url) ?? "download");
    if (!name) throw new Error("Missing download filename");
    const active = AbortSignal.any([AbortSignal.timeout(2 * 3600_000), ...(signal ? [signal] : [])]);
    await mkdir(root, { recursive: true });
    dir = await mkdtemp(path.join(root, "http-"));
    let localPath = path.join(dir, "body");
    let file = previous?.files[0];
    let cached = false;
    // A reclaimed job may already have published the journaled bytes.
    const target = getDownloadTargetRelativePath("/", path.posix.join(input.targetPath, name));
    if (file) {
      const savedPath = path.join(root, file.sha256);
      // A crash after journaling can resume publication even if the source URL expired.
      cached = await hashTransferFile(savedPath, active).catch(() => null) === file.sha256;
      if (cached) localPath = savedPath;
    }
    const alreadyOnAgent = file && !cached && !input.publishSftp && task.agentRootIdentity
      && await createAgentFileClient(input.nodeId, input.serverId, task.agentRootIdentity).matches(target, file.size, file.sha256);
    if (!file || (!cached && !alreadyOnAgent)) {
      const downloaded = await fetchToDisk(input, name, localPath, active);
      if (file && (file.sha256 !== downloaded.sha256 || file.size !== downloaded.size || file.name !== name)) throw new Error("Download changed during retry");
      file = downloaded;
      await link(localPath, path.join(root, file.sha256)).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      });
      await prisma.downloadTask.update({ where, data: { transferManifest: { version: 1, files: [file], ...(task.agentRootIdentity ? { agentRootIdentity: task.agentRootIdentity } : {}) }, progress: t("backend.downloads.progress.transferring") } });
      journaled = true;
    }
    if (input.publishSftp) await input.publishSftp(localPath, file, active);
    else await publishAgentDownloadFile({ ...input, localPath, signal: active, file });
    const total = String(file.size);
    const done = await prisma.downloadTask.updateMany({ where, data: { status: "COMPLETED", fileName: file.name,
      completedBytes: total, totalBytes: total, fileSize: total, progress: t("backend.downloads.progress.completedAndTransferred") } });
    completed = done.count > 0;
    if (completed && task.createdBy) await notifyDownloadResult(task.createdBy, downloadNotificationSource(input.url), "completed", undefined, task.teamId).catch(() => {});
  } catch (error) {
    if (signal?.aborted || journaled) throw error;
    const message = error instanceof BusinessError ? error.message : getPublicDownloadError(error);
    const failed = await prisma.downloadTask.updateMany({ where, data: { status: "FAILED", errorMessage: message } });
    if (failed.count && task.createdBy) await notifyDownloadResult(task.createdBy, downloadNotificationSource(input.url), "failed", message, task.teamId).catch(() => {});
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
    if (!signal?.aborted && (completed || (!journaled && !await prisma.downloadTask.count({ where }))))
      await rm(root, { recursive: true, force: true });
  }
}
