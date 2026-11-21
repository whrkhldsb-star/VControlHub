import { prepareTrackerEgress } from "./tracker-egress";
import { relayContentStatus } from "./relay-status";
import { publishAgentDownloadFile, receiveAgentHttpDownload } from "./agent-relay";
import { isMagnetLink } from "./helpers";
import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * Download execution strategies — aria2 relay and direct download.
 * Extracted from route.ts for maintainability.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createLogger, logError } from "@/lib/logging";

const notifyLogger = createLogger("downloads-notify");
import { notifyDownloadResult } from "@/lib/notification/service";
import {
 ensureAria2Daemon,
 addUri, changeOption,
 removeDownload,
 getPublicAria2Error,
 type Aria2Status,
} from "@/lib/aria2/service";
import { execRemoteCommand, buildSshParamsFromServer, connectSsh, createVerifiedSshConfig } from "@/lib/ssh/client";
import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import {
 buildDirectDownloadCommand,
 buildDirectDownloadStopCommand,
 getDirectDownloadLogCommand,
 parseDirectDownloadStopResult,
 shellQuote,
 toRemoteChildPath,
} from "@/lib/downloads/remote-command";
import {
 normalizeDownloadFileName,
 downloadNotificationSource, deriveDownloadFileNameFromUrl,
 relativePathFromDownloadTarget,
 indexDownloadedFileEntry,
 getPublicDownloadError,
 buildProgressText,
} from "@/lib/downloads/helpers";
import { executionRefusal, loadExecutionActor } from "@/lib/auth/execution-actor";
import { lockStorageFileOverwrite } from "@/lib/storage/file-overwrite-lock";
import { assertRemotePathContained } from "@/lib/storage/remote-containment";
import { resolveStorageSshCredentials, STORAGE_SSH_SERVER_SELECT, type StorageSshCredentialNode } from "@/lib/storage/ssh-credentials";
import { resolveDownloadTargetPath } from "./target-path";
import { assertNotRecycled } from "@/lib/storage/archive-access";
import { BusinessError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { assertStorageAccess, releaseStorageQuotaGuard, largestAllowedWrite, type StorageWriteCapacity } from "@/lib/storage/access-control";
import { relayTempDir } from "@/lib/runtime/platform-paths";
import type { DownloadSourceResolution } from "@/lib/downloads/source-url";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { relayMetadataGid, relayPauseDeadline, hashTransferFile, parseTransferManifest, type TransferManifest } from "./transfer-manifest";
import { pinHttpSourceForAria2, resolveDownloadRedirects } from "@/lib/downloads/redirect-chain";



async function loadDownloadTeamId(taskId: string): Promise<string | null> {
  const row = await prisma.downloadTask.findUnique({
    where: { id: taskId },
    select: { teamId: true },
  });
  return row?.teamId ?? null;
}

/* ── Shared server type ────────────────────────────────── */

export type DownloadServer = {
 teamId?: string | null;
 agentStorageNodeId?: string;
 agentRootIdentity?: string;
 id: string;
 host: string;
 port: number;
 username: string;
 /** With managementMode: an Agent-managed server runs the download through its Agent. */
 operatingSystem: string;
 managementMode: string;
 connectionType: string;
 sshKeyId: string | null;
 password: string | null;
 hostKeySha256: string | null;
 storageNode?: { id: string; basePath: string | null } | null;
 sshKey?: { teamId?: string | null; privateKey: string; passphrase?: string } | null;
};

/* ── Aria2 relay download ──────────────────────────────── */

/** A relay source (or one of its redirects) failed the public-address checks. */
class DownloadSourceRejectedError extends Error {
 constructor(reason: string) {
  super(reason);
  this.name = "DownloadSourceRejectedError";
 }
}

export async function executeAria2RelayDownload(
 taskId: string,
 server: DownloadServer,
 urls: string[],
 targetPath: string,
 fileName?: string | null,
 maxSpeedKb?: number | null,
 userId?: string,
 signal?: AbortSignal,
 /** The creator's storage limits for the target; the relay knows the real sizes before publishing. */
 limits?: StorageWriteCapacity,
 stagedHttp = false,
) {
 if (stagedHttp && server.storageNode && !server.agentStorageNodeId) {
  return receiveAgentHttpDownload({ taskId, serverId: server.id, nodeId: server.storageNode.id, url: urls[0]!,
   targetPath, fileName, maxSpeedKb, signal, limits,
   publishSftp: (local, file, active) => publishSftpDownloadFile(taskId, server, targetPath, local, file, active),
  });
 }
 if (server.agentStorageNodeId && urls.length === 1 && !isMagnetLink(urls[0]!)) {
  return receiveAgentHttpDownload({ taskId, serverId: server.id, nodeId: server.agentStorageNodeId, url: urls[0]!,
   targetPath, fileName, maxSpeedKb, signal, limits });
 }
 const tempDir = relayTempDir(taskId);
 const teamId = await loadDownloadTeamId(taskId);

 let gid: string;
 // The gid we STARTED ourselves (fresh-claim path only). If the dispatch later
 // throws before the poll loop's own cleanup, the outer catch force-removes it
 // so a failed dispatch never leaves an orphaned aria2 download running with no
 // DB row tracking it. Stays null on the resume path — that gid belongs to a
 // live sibling worker and must not be removed here.
 let metadataGid: string | undefined;
 let ownedGid: string | null = null;
 let trackerEgress: Awaited<ReturnType<typeof prepareTrackerEgress>> | undefined;
 let preparedManifest: TransferManifest | null = null;
 try {
  // Claim BEFORE starting the aria2 download. Historically addUri ran first and
  // the PENDING→RUNNING CAS ran second: a retry (maxAttempts=3) or a concurrent
  // tick would then (1) spawn a *duplicate* aria2 download into the shared
  // tempDir and (2) on the CAS miss call cleanupTemp() — wiping the tempDir out
  // from under the still-active first download. Claiming first makes the side
  // effect exclusive to the winner; a loser resumes by the stored gid instead.
  // A paused task is PENDING too, but carries its gid (A5-01): a reclaim must
  // continue it, not start a second aria2 download into the same tempDir.
  const reservedGid = randomBytes(8).toString("hex");
  signal?.throwIfAborted();
  const claimed = await prisma.downloadTask.updateMany({
   where: { id: taskId, status: "PENDING", aria2Gid: null },
   data: { status: "RUNNING", aria2Gid: reservedGid, progress: t("backend.downloads.progress.relayStarting") },
  });

  if (claimed.count > 0) {
   await ensureAria2Daemon();
   // Fresh claim — we own this task; start the download.
   await fs.mkdir(tempDir, { recursive: true });

   // aria2 runs on the control plane and resolves/redirects on its own, so it
   // must never follow a redirect: the chain is resolved here, every hop
   // validated against the public-address rules (see redirect-chain.ts).
   const resolvedUrls: string[] = [];
   // A single plain-http source is pinned to the address that passed the
   // checks (Host header carries the name); aria2 options apply to the whole
   // download, so a multi-source request keeps the hostnames.
   const pinnedOptions: Record<string, string> = {};
   for (const url of urls) {
    const resolved = await resolveDownloadRedirects(url);
    if (!resolved.ok) throw new DownloadSourceRejectedError(resolved.reason);
    if (urls.length === 1) {
     const pinned = pinHttpSourceForAria2(resolved.url, resolved.resolution);
     resolvedUrls.push(pinned.uri);
     Object.assign(pinnedOptions, pinned.options);
    } else {
     resolvedUrls.push(resolved.url);
    }
   }
   if (urls.some(isMagnetLink)) trackerEgress = await prepareTrackerEgress(resolvedUrls);
   const options: Record<string, string> = {
    ...trackerEgress?.options,
    gid: reservedGid, dir: tempDir,
    "seed-time": "0",
    "max-redirect": "0",
    ...pinnedOptions,
   };
   if (maxSpeedKb) options["max-download-limit"] = `${maxSpeedKb}K`;

   signal?.throwIfAborted();
   gid = await addUri(trackerEgress?.uris ?? resolvedUrls, options);
   ownedGid = gid;
   if (gid !== reservedGid) throw new Error("Aria2 did not honor the reserved gid");

   const recorded = await prisma.downloadTask.updateMany({
    where: { id: taskId, aria2Gid: reservedGid, status: { in: ["RUNNING", "PENDING"] } },
    data: { aria2Gid: gid, progress: t("backend.downloads.progress.relayInProgress") },
   });
   if (!recorded.count) {
    await removeDownload(gid, true).catch(err => logError("[DownloadAPI] Failed to remove cancelled download:", err));
    await cleanupTemp(tempDir);
    return;
   }
  } else {
   // Not PENDING — a retry or concurrent tick. Resume the download already
   // started by the original dispatch (reuse its gid); never start a duplicate
   // and never wipe the shared tempDir a live sibling worker may be writing to.
   const current = await prisma.downloadTask.findUnique({
    where: { id: taskId },
    select: { status: true, aria2Gid: true, transferManifest: true },
   });
   if (current?.status === "RUNNING") preparedManifest = parseTransferManifest(current.transferManifest);
   if (preparedManifest) {
    await publishRelayFiles(taskId, server, tempDir, targetPath, preparedManifest, signal);
    if (userId) notifyDownloadResult(userId, downloadNotificationSource(urls[0]!), "completed", undefined, teamId).catch((error) => notifyLogger.warn("notifyDownloadResult failed", { error: String(error) }));
    await cleanupTemp(tempDir);
    return;
   }
   // RUNNING with a gid resumes; PENDING with a gid is paused by the user and
   // waits in the loop below until it is resumed or given up on.
   if (current?.status === "RUNNING" && !current.aria2Gid) throw new Error("Running relay has no recorded gid");
   if (!current || (current.status !== "RUNNING" && current.status !== "PENDING") || !current.aria2Gid) {
    logError(
     `[DownloadAPI] Relay task ${taskId} not resumable (status=${current?.status ?? "missing"}, gid=${current?.aria2Gid ?? "none"}); skipping without touching tempDir`,
    );
    return;
   }
   gid = current.aria2Gid;
   metadataGid = relayMetadataGid(current.transferManifest);
   await ensureAria2Daemon();
   if (urls.some(isMagnetLink)) {
    const content = await relayContentStatus(gid);
    if (["active", "waiting", "paused"].includes(content.status.status)) {
     trackerEgress = await prepareTrackerEgress(urls);
     signal?.throwIfAborted();
     await changeOption(content.gid, trackerEgress.options);
    }
   }
   await fs.mkdir(tempDir, { recursive: true });
  }

  let done = false;
  let torrentFiles: Map<string, string> | undefined;
  let elapsed = 0;
  const maxWait = 7200;
  // Seconds the user has kept the task paused: not part of the two-hour budget, but not for ever either
  // (a paused task holds one of the worker's places).


  while (!done && elapsed < maxWait) {
   await new Promise((r) => setTimeout(r, 5000));
   elapsed += 5;

   // Lease lost mid-transfer: stop polling and return WITHOUT marking the row
   // terminal, leaving the aria2 download running. A reclaiming worker resumes
   // by the stored gid (the "not PENDING" branch above). Marking FAILED here
   // would race that resume and surface a spurious failure to the user.
   if (signal?.aborted) {
    logError(`[DownloadAPI] Relay task ${taskId} lease lost; pausing poll for reclaim`);
    return;
   }

   try {
    // Stop if cancelled/terminal while polling.
    const current = await prisma.downloadTask.findUnique({
     where: { id: taskId },
     select: { status: true, transferManifest: true, updatedAt: true },
    });
    if (!current || current.status === "CANCELLED" || current.status === "FAILED" || current.status === "COMPLETED") {
     try {
      await removeDownload(gid);
     } catch {
      /* best-effort */
     }
     if (!current?.transferManifest) await cleanupTemp(tempDir);
     return;
    }

    // Paused by the user (the row goes back to PENDING): the download is stopped in aria2, the wait does not
    // count against the two-hour budget, and a task left paused for a day is given up.
    if (current.status === "PENDING") {
     elapsed -= 5;
     if (relayPauseDeadline(current) <= Date.now()) {
      const expired = await prisma.downloadTask.updateMany({ where: { id: taskId, status: "PENDING", updatedAt: current.updatedAt }, data: { status: "FAILED", errorMessage: t("backend.downloads.relayPausedTooLong") } });
      if (!expired.count) continue;
      try { await removeDownload(gid, true); } catch { /* terminal cleanup retries */ }
      await cleanupTemp(tempDir);
      return;
     }
     continue;
    }


    const { gid: contentGid, status: st } = await relayContentStatus(gid);
    if (gid !== contentGid) {
     const advanced = await prisma.downloadTask.updateMany({
      where: { id: taskId, aria2Gid: gid, status: "RUNNING" },
      data: { aria2Gid: contentGid, transferManifest: { metadataGid: metadataGid ?? gid } },
     });
     if (!advanced.count) continue;
     metadataGid ??= gid;
     gid = contentGid;
     if (ownedGid) ownedGid = gid;
    }
    const progress = buildProgressText(st);
    await prisma.downloadTask.updateMany({
     where: { id: taskId, status: "RUNNING" },
     data: { progress, completedBytes: st.completedLength, totalBytes: st.totalLength, downloadSpeed: st.downloadSpeed },
    });

    // A torrent announces its size early. Hold it to the creator's limits and to the disk it is written to now,
    // not after hours of downloading (the limits used to be checked only once everything had arrived).
    if (st.status !== "complete" && st.status !== "error" && st.status !== "removed" && Number(st.totalLength) > 0) {
     const problem = await relayCapacityProblem(Number(st.totalLength), Number(st.completedLength) || 0, limits, tempDir, st.files);
     if (problem) {
      try { await removeDownload(gid, true); } catch { /* best-effort */ }
      await prisma.downloadTask.updateMany({ where: { id: taskId, status: { in: ["PENDING", "RUNNING"] } }, data: { status: "FAILED", errorMessage: problem } });
      if (userId) notifyDownloadResult(userId, downloadNotificationSource(urls[0]!), "failed", problem, teamId).catch((err) => { notifyLogger.warn("notifyDownloadResult failed", { error: err instanceof Error ? err.message : String(err) }); });
      await cleanupTemp(tempDir);
      return;
     }
    }

    if (st.status === "complete") {
     if (urls.some(isMagnetLink)) {
      // Only the completed payload has a torrent info dictionary and selected data files.
      if (!st.bittorrent?.info?.name) throw new Error("aria2 completed metadata without a content download");
      torrentFiles = new Map(st.files.filter(file => file.selected === "true").map(file => {
       if (file.completedLength !== file.length || !/^\d+$/.test(file.length)) throw new Error("Incomplete torrent file");
       return [path.resolve(file.path), file.length];
      }));
      if (!torrentFiles.size) throw new Error("Missing torrent content");
     }
     done = true;
    } else if (st.status === "error" || st.status === "removed") {
     // "removed" is also what a user cancel looks like from here: the row is
     // already CANCELLED then, and the miss below keeps the failure notice
     // from being sent on top of the cancellation (A5-02).
     const failed = await prisma.downloadTask.updateMany({
      where: { id: taskId, status: "RUNNING" },
      data: { status: "FAILED", errorMessage: apiCopy("apiCopy.aria2.download.failed.3098e047", { v0: String(st.status) }) },
     });
     if (failed.count > 0 && userId) notifyDownloadResult(userId, downloadNotificationSource(urls[0]!), "failed", `aria2 download failed: ${st.status}`, teamId).catch((err) => { notifyLogger.warn("notifyDownloadResult failed", { error: err instanceof Error ? err.message : String(err) }); });
     await cleanupTemp(tempDir);
     return;
     }
   } catch (err) {
    logError("[DownloadAPI] aria2 status poll failed:", err);
    await prisma.downloadTask.updateMany({
     where: { id: taskId, status: "RUNNING" },
     data: { status: "FAILED", errorMessage: t("backend.downloads.relayStatusVerificationFailed") },
    });
    if (userId) notifyDownloadResult(userId, downloadNotificationSource(urls[0]!), "failed", t("backend.downloads.relayStatusVerificationFailed"), teamId).catch((notifyError) => { notifyLogger.warn("notifyDownloadResult failed", { error: notifyError instanceof Error ? notifyError.message : String(notifyError) }); });
    try { await removeDownload(gid, true); } catch { /* best effort */ }
    await cleanupTemp(tempDir);
    return;
   }
  }

  if (!done) {
   try { await removeDownload(gid, true); } catch (err) { logError("[DownloadAPI] Failed to remove aria2 download on timeout:", err); }
   await prisma.downloadTask.updateMany({ where: { id: taskId, status: { in: ["PENDING", "RUNNING"] } }, data: { status: "FAILED", errorMessage: apiCopy("apiCopy.download.timed.out.2.hour.limit.1edecc2e") } });
   if (userId) notifyDownloadResult(userId, downloadNotificationSource(urls[0]!), "failed", { key: "notification.reason.downloadTimedOut" }, teamId).catch((err) => { notifyLogger.warn("notifyDownloadResult failed", { error: err instanceof Error ? err.message : String(err) }); });
   await cleanupTemp(tempDir);
   return;
  }

  await prisma.downloadTask.updateMany({ where: { id: taskId, status: "RUNNING" }, data: { progress: t("backend.downloads.progress.transferring") } });

  const listed = await listRelayFiles(tempDir, "", torrentFiles);
  const filesToTransfer = torrentFiles ? listed.filter(name => torrentFiles.has(path.resolve(tempDir, name))) : listed;
  if (torrentFiles && filesToTransfer.length !== torrentFiles.size) throw new Error("Missing torrent content");

  if (filesToTransfer.length === 0) {
   await prisma.downloadTask.updateMany({ where: { id: taskId, status: "RUNNING" }, data: { status: "FAILED", errorMessage: apiCopy("apiCopy.download.completed.but.file.not.found.191e1079") } });
   if (userId) notifyDownloadResult(userId, downloadNotificationSource(urls[0]!), "failed", { key: "notification.reason.downloadFileMissing" }, teamId).catch((err) => { notifyLogger.warn("notifyDownloadResult failed", { error: err instanceof Error ? err.message : String(err) }); });
   await cleanupTemp(tempDir);
   return;
  }

  const customName = normalizeDownloadFileName(fileName);
  if (customName && filesToTransfer.length !== 1) throw new DownloadSourceRejectedError(t("backend.downloads.multiFileName"));
  const files: TransferManifest["files"] = [];
  for (const f of filesToTransfer) {
   signal?.throwIfAborted();
   const local = path.join(tempDir, ...f.split("/"));
   const stat = await fs.stat(local);
   if (torrentFiles && String(stat.size) !== torrentFiles.get(path.resolve(local))) throw new Error("Incomplete torrent file");
   files.push({ name: customName ?? f, ...(customName && customName !== f ? { sourceName: f } : {}), size: stat.size, sha256: await hashTransferFile(local, signal) });
  }
  // Sizes are known now, before anything reaches the VPS: hold them to the
  // creator's per-file limit and what the quota has left.
  if (limits && relayExceedsLimits(files, limits)) {
   throw new DownloadSourceRejectedError(t("backend.downloads.storageLimitExceeded"));
  }
  const manifest = parseTransferManifest({ version: 1, files, metadataGid, agentRootIdentity: server.agentRootIdentity })!;
  const journaled = await prisma.downloadTask.updateMany({
   where: { id: taskId, status: "RUNNING" },
   data: { transferManifest: manifest },
  });
  if (!journaled.count) return;
  preparedManifest = manifest;
  await publishRelayFiles(taskId, server, tempDir, targetPath, manifest, signal);
  if (userId) notifyDownloadResult(userId, downloadNotificationSource(urls[0]!), "completed", undefined, teamId).catch((err) => { notifyLogger.warn("notifyDownloadResult failed", { error: err instanceof Error ? err.message : String(err) }); });

  await cleanupTemp(tempDir);
 } catch (error) {
  logError("[DownloadAPI] Relay download execution failed:", error);
  // Preserve the durable manifest and local files for a replacement worker.
  // A lost lease must never publish, delete data or mark another owner's task failed.
  if (signal?.aborted) throw error;
  if (preparedManifest) throw error;
  // Force-remove the download we started so a mid-dispatch throw (e.g. the
  // gid-persist updateMany failing right after addUri) can't orphan a live
  // aria2 job. Best-effort; never masks the original error.
  if (ownedGid) {
   try { await removeDownload(ownedGid, true); } catch { /* best-effort */ }
  }
  try {
   const publicError = error instanceof DownloadSourceRejectedError ? error.message : getPublicAria2Error(error);
   await prisma.downloadTask.updateMany({ where: { id: taskId, status: { in: ["PENDING", "RUNNING"] } }, data: { status: "FAILED", errorMessage: publicError } });
   if (userId) notifyDownloadResult(userId, downloadNotificationSource(urls[0]!), "failed", publicError, teamId).catch((err) => { notifyLogger.warn("notifyDownloadResult failed", { error: err instanceof Error ? err.message : String(err) }); });
  } catch (err) { logError("[DownloadAPI] Failed to update task status after relay failure:", err); }
  await cleanupTemp(tempDir);
 } finally { trackerEgress?.close(); }
}

/**
 * Every file aria2 left in the relay folder, as "/"-separated paths. A
 * multi-file torrent arrives as a folder of files; only the top level used to
 * be read, so such a download failed after finishing and its files were
 * deleted. aria2's control files are skipped; anything
 * that is neither a file nor a folder (a link) is refused.
 */
export async function listRelayFiles(root: string, prefix = "", selected?: ReadonlyMap<string, string> | null): Promise<string[]> {
 const out: string[] = [];
 for (const entry of await fs.readdir(path.join(root, ...prefix.split("/").filter(Boolean)), { withFileTypes: true })) {
  const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile() && entry.name.endsWith(".aria2") && !selected?.has(path.resolve(root, relative))) continue;
  if (entry.isDirectory()) out.push(...await listRelayFiles(root, relative, selected));
  else if (entry.isFile()) out.push(relative);
  else throw new Error("Relay output contains a non-file entry");
 }
 return out.sort();
}

/** Whether relayed files break the per-file limit, or together the quota left. */
/** Free space on the control plane that a relay download leaves alone, for the system and everything else on it. */
const RELAY_DISK_RESERVE_BYTES = 5 * 1024 ** 3;


/** Why a torrent of this size must not go on, or null: the creator's limits, or the disk the relay writes to. */
export async function relayCapacityProblem(
 totalBytes: number, completedBytes: number, limits: StorageWriteCapacity | undefined, dir: string,
 files: ReadonlyArray<Pick<Aria2Status["files"][number], "selected" | "length">> = [],
): Promise<string | null> {
 if (limits) {
  const { remainingBytes, maxFileBytes } = limits;
  const overQuota = remainingBytes !== null && BigInt(totalBytes) > remainingBytes;
  const oversizedFile = maxFileBytes !== null && files.some(file =>
   file.selected === "true" && BigInt(file.length) > maxFileBytes);
  if (overQuota || oversizedFile) return t("backend.downloads.storageLimitExceeded");
 }
 const stats = await fs.statfs(dir).catch(() => null);
 if (stats) {
  const free = Number(stats.bavail) * Number(stats.bsize);
  if (totalBytes - completedBytes > free - RELAY_DISK_RESERVE_BYTES) return t("backend.downloads.relayDiskInsufficient");
 }
 return null;
}

export function relayExceedsLimits(files: Array<{ size: number }>, limits: StorageWriteCapacity): boolean {
 const total = files.reduce((sum, file) => sum + BigInt(file.size), BigInt(0));
 const largest = files.reduce((max, file) => (BigInt(file.size) > max ? BigInt(file.size) : max), BigInt(0));
 return (limits.maxFileBytes !== null && largest > limits.maxFileBytes)
  || (limits.remainingBytes !== null && total > limits.remainingBytes);
}

/** Detached processes are controlled via the bound server throughout their lifetime. */
export function resolveBoundDownloadEndpoint(node: StorageSshCredentialNode) {
 const endpoint = resolveStorageSshCredentials(node);
 const server = node.server;
 if (!server || endpoint.host.toLowerCase() !== server.host.toLowerCase() || endpoint.port !== server.port
  || endpoint.username !== server.username || endpoint.hostKeySha256 !== server.hostKeySha256) {
  throw new BusinessError(t("backend.downloads.storageEndpointMismatch"));
 }
 return endpoint;
}

async function verifyRelayDestination(db: Pick<Prisma.TransactionClient, "storageNode">, server: DownloadServer,
 node: { id: string; basePath: string | null }) {
 const current = await db.storageNode.findFirst({
  where: { id: node.id, driver: "SFTP", serverId: server.id, teamId: server.teamId,
   server: { enabled: true, teamId: server.teamId } },
  select: { basePath: true, teamId: true, host: true, port: true, username: true, hostKeySha256: true,
   server: { select: STORAGE_SSH_SERVER_SELECT } },
 });
 if (!current?.server || current.basePath !== node.basePath
  || current.server.operatingSystem !== server.operatingSystem || current.server.managementMode !== server.managementMode) {
  throw new BusinessError(t("backend.downloads.taskStorageMissing"));
 }
 const endpoint = resolveBoundDownloadEndpoint(current);
 if (endpoint.host.toLowerCase() !== server.host.toLowerCase() || endpoint.port !== server.port
  || endpoint.username !== server.username || endpoint.hostKeySha256 !== server.hostKeySha256
  || endpoint.connectionType !== server.connectionType) {
  throw new BusinessError(t("backend.downloads.storageEndpointMismatch"));
 }
}

/** Re-admit the actual file and hold the quota and overwrite locks through its index update. */
async function publishSftpDownloadFile(taskId: string, server: DownloadServer, targetPath: string,
 localPath: string, file: TransferManifest["files"][number], signal?: AbortSignal) {
 const node = server.storageNode;
 if (!node) throw new BusinessError(t("backend.downloads.taskStorageMissing"));
 const relative = relativePathFromDownloadTarget(node.basePath, targetPath, file.name);
 if (!relative) throw new BusinessError(t("backend.downloads.taskStorageMissing"));
 const task = await prisma.downloadTask.findFirstOrThrow({ where: { id: taskId, serverId: server.id, status: "RUNNING",
  server: { enabled: true, storageNode: { id: node.id } } }, select: { createdBy: true, teamId: true } });
 const actor = await loadExecutionActor(task.createdBy, task.teamId);
 if (!actor) throw new BusinessError(t("backend.execution.ownerInactive"));
 const refusal = await executionRefusal({ actor, createdBy: task.createdBy, teamId: task.teamId,
  permission: "storage:write", serverIds: [server.id] });
 if (refusal) throw new BusinessError(refusal);
 const admission = await assertStorageAccess({ session: actor, storageNodeId: node.id, relativePath: relative, operation: "write", writeBytes: file.size });
 if (!admission.allowed) throw new BusinessError(t("backend.downloads.storageLimitExceeded"));
 try {
  const unlock = await lockStorageFileOverwrite(node.id, relative);
  try {
   signal?.throwIfAborted();
   await assertNotRecycled(node.id, relative, "write");
   await verifyRelayDestination(prisma, server, node);
   const params = await buildSshParamsFromServer(server, server.sshKey);
   const remote = await assertRemotePathContained(params, resolveDownloadTargetPath(node.basePath, ""), toRemoteChildPath(targetPath, file.name));
   const mkdir = await execRemoteCommand({ ...params, command: `mkdir -p -- ${shellQuote(path.posix.dirname(remote))}`, timeout: 15000, signal });
   if (mkdir.exitCode !== 0) throw new Error("Cannot prepare relay destination");
   // Stage and checksum the file outside the transaction. Pin the current binding
   // across the final rename and index write, including a recovered, already-published file.
   await transferFileViaSsh2(server, localPath, remote, taskId, signal, file.sha256, async rename => {
    await prisma.$transaction(async tx => {
     const binding = await tx.$queryRaw<{ id: string }[]>`
      SELECT n.id FROM "StorageNode" n JOIN servers s ON s.id = n."serverId"
      WHERE n.id = ${node.id} AND s.id = ${server.id} FOR SHARE OF n, s`;
     if (!binding.length) throw new BusinessError(t("backend.downloads.taskStorageMissing"));
     await verifyRelayDestination(tx, server, node);
     signal?.throwIfAborted();
     await rename();
     await indexDownloadedFileEntry({ storageNode: node, targetPath: path.posix.dirname(toRemoteChildPath(targetPath, file.name)),
      fileName: path.posix.basename(file.name), size: file.size }, tx);
    }, { timeout: 30000 });
   });
  } finally { await unlock(); }
 } finally { await releaseStorageQuotaGuard(admission); }
}

async function publishRelayFiles(taskId: string, server: DownloadServer, tempDir: string,
 targetPath: string, manifest: TransferManifest, signal?: AbortSignal) {
 if (server.agentStorageNodeId && (!server.agentRootIdentity || manifest.agentRootIdentity !== server.agentRootIdentity)) {
  throw new BusinessError(t("backend.fileAgent.unavailable"));
 }
 for (const file of manifest.files) {
  signal?.throwIfAborted();
  const task = await prisma.downloadTask.findUnique({ where: { id: taskId }, select: { status: true } });
  if (task?.status !== "RUNNING") throw new Error("Relay task is no longer running");
  if (server.agentStorageNodeId) {
   await publishAgentDownloadFile({ taskId, serverId: server.id, nodeId: server.agentStorageNodeId,
    localPath: path.join(tempDir, ...(file.sourceName ?? file.name).split("/")), targetPath, file, signal });
   continue;
  }
  await publishSftpDownloadFile(taskId, server, targetPath, path.join(tempDir, ...(file.sourceName ?? file.name).split("/")), file, signal);
 }
 signal?.throwIfAborted();
 const totalSize = manifest.files.reduce((sum, file) => sum + BigInt(file.size), BigInt(0)).toString();
 const completed = await prisma.downloadTask.updateMany({ where: { id: taskId, status: "RUNNING" },
  data: { status: "COMPLETED", fileName: manifest.files.length === 1 && !manifest.files[0]!.name.includes("/") ? manifest.files[0]!.name : null,
   progress: t("backend.downloads.progress.completedAndTransferred"), fileSize: totalSize, totalBytes: totalSize, completedBytes: totalSize } });
 if (!completed.count) throw new Error("Relay task changed before finalization");
}

/* ── Direct download (HTTP/HTTPS) on remote VPS ────────── */

export async function executeDirectDownload(
taskId: string,
server: DownloadServer,
url: string,
targetPath: string,
fileName?: string | null,
userId?: string,
sourceResolution?: DownloadSourceResolution,
/** The creator's storage limits; the remote script enforces the largest allowed size. */
limits?: StorageWriteCapacity,
/** The task's speed limit in KB/s, applied by curl on the VPS. */
maxSpeedKb?: number | null,
signal?: AbortSignal,
) {
 signal?.throwIfAborted();
 const teamId = await loadDownloadTeamId(taskId);
 let sshParams: Awaited<ReturnType<typeof buildSshParamsFromServer>> | null = null;
 let spawnAttempted = false;
 let remotePid: number | null = null;

 try {
  if (!sourceResolution) {
   throw new Error("Download source DNS resolution is missing; retry the download request");
  }

  // Claim BEFORE spawning the remote downloader. Spawning first let a retry
  // (maxAttempts=3) / concurrent tick launch a duplicate remote process against
  // the same target file before the CAS could reject it; the loser then had to
  // race to kill an already-writing orphan. Claiming first makes the spawn
  // exclusive to the winner.
  const claimed = await prisma.downloadTask.updateMany({
   where: { id: taskId, status: "PENDING" },
   data: { status: "RUNNING", progress: t("backend.downloads.progress.directStarting") },
  });
  if (claimed.count === 0) {
   logError(`[DownloadAPI] Direct task ${taskId} was not PENDING; skipping duplicate remote spawn`);
   return;
  }

  // curl on the target follows no redirect (--max-redirs 0): a redirect target
  // has not passed the public-address checks. Resolve the chain here first,
  // every hop validated, as relay downloads do. Every redirecting link — a
  // GitHub release asset answers 302 to a signed CDN URL — failed with curl
  // error 47 ("Maximum (0) redirects followed").
  const resolved = await resolveDownloadRedirects(url);
  if (!resolved.ok) throw new DownloadSourceRejectedError(resolved.reason);

  const finalName = fileName || deriveDownloadFileNameFromUrl(url) || "download";
  const node = server.storageNode;
  if (!node) throw new BusinessError(t("backend.downloads.taskStorageMissing"));
  const relative = relativePathFromDownloadTarget(node.basePath, targetPath, finalName);
  if (!relative) throw new BusinessError(t("backend.downloads.taskStorageMissing"));
  await assertNotRecycled(node.id, relative, "write");
  sshParams = await buildSshParamsFromServer(server, server.sshKey);
  const basePath = resolveDownloadTargetPath(node.basePath, "");
  const physicalFile = await assertRemotePathContained(sshParams, basePath, toRemoteChildPath(targetPath, finalName));

  const downloadCmd = buildDirectDownloadCommand({
   taskId,
   url: resolved.url,
   basePath,
   physicalTargetDir: path.posix.dirname(physicalFile),
   targetPath,
   // Named after the link the user gave, as the task list, the refresh probe
   // and reconciliation name it — not the CDN object the chain ended at.
   fileName: finalName,
   sourceResolution: resolved.resolution ?? sourceResolution,
   maxBytes: limits ? largestAllowedWrite(limits) : null,
   maxSpeedKb: maxSpeedKb ?? null,
  });
  signal?.throwIfAborted();
  spawnAttempted = true;
  const { stdout: pidOutput, exitCode } = await execRemoteCommand({ ...sshParams, signal, command: downloadCmd, timeout: 30000 });
  const pid = parseInt(pidOutput.trim(), 10);

  if (exitCode === 0 && pid > 0) {
   remotePid = pid;
   // Record the pid on the row we already claimed to RUNNING above.
   const recorded = await prisma.downloadTask.updateMany({
    where: { id: taskId, status: "RUNNING" },
    data: { pid, fileName: finalName, progress: t("backend.downloads.progress.downloading") },
   });
   if (recorded.count === 0) {
    // Cancelled while the remote process was being started: the cancel could
    // not see it yet, so stopping it is this worker's job.
    logError(`[DownloadAPI] Direct task ${taskId} was cancelled during spawn; stopping the remote download`);
    await stopRemoteDirectDownload(sshParams, taskId, targetPath, fileName || deriveDownloadFileNameFromUrl(url) || "download");
    return;
   }
  } else {
   const { stdout: logContent } = await execRemoteCommand({ ...sshParams, command: getDirectDownloadLogCommand(taskId), timeout: 8000 });
   // 127 is the launcher's own "no bash on this host" (remote-command.ts); the log is empty then.
   const errMsg = exitCode === 127 && !logContent.trim() ? t("backend.downloads.remoteBashMissing") : (logContent.trim() || t("backend.downloads.startFailed"));
   if (exitCode === 127 || exitCode === 65) spawnAttempted = false;
   throw new DownloadSourceRejectedError(errMsg);
  }
 } catch (error) {
  if (signal?.aborted) throw signal.reason;
  logError("[DownloadAPI] Direct download execution failed:", error);
  // The remote process is detached by design. If a local indexing or database
  // step fails after launch, terminate this task's download processes and
  // task-owned marker files; otherwise a failed row leaves a live
  // curl writing into the target and a retry creates a duplicate download.
  if (sshParams && spawnAttempted && !await stopRemoteDirectDownload(sshParams, taskId, targetPath, fileName || deriveDownloadFileNameFromUrl(url) || "download")) {
   await prisma.downloadTask.updateMany({
    where: { id: taskId, status: "RUNNING" },
    data: { ...(remotePid ? { pid: remotePid } : {}), progress: t("apiDownloads.remoteProcessCancelFailed") },
   });
   return;
  }
  try {
   // A rejected redirect target says why (as for relay downloads).
   const publicError = error instanceof DownloadSourceRejectedError ? error.message : getPublicDownloadError(error);
   await prisma.downloadTask.updateMany({
    where: { id: taskId, status: "RUNNING" },
    data: { status: "FAILED", errorMessage: publicError },
   });
   if (userId) notifyDownloadResult(userId, downloadNotificationSource(url), "failed", publicError, teamId).catch((err) => { notifyLogger.warn("notifyDownloadResult failed", { error: err instanceof Error ? err.message : String(err) }); });
  } catch (err) { logError("[DownloadAPI] Failed to update task status after direct download failure:", err); }
 }
}

/** Stop every process of a direct download this worker started (best effort, logged). */
async function stopRemoteDirectDownload(
 sshParams: Awaited<ReturnType<typeof buildSshParamsFromServer>>,
 taskId: string,
 targetPath: string,
 fileName: string,
) {
 try {
  const result = await execRemoteCommand({ ...sshParams, command: buildDirectDownloadStopCommand(taskId, targetPath, { cancel: true, fileName }), timeout: 20000 });
  const state = parseDirectDownloadStopResult(result);
  if (state === "PUBLISHED") return false; // Reconciliation owns the committed result.
  if (state) return true;
  logError(`[DownloadAPI] Remote direct download ${taskId} could not be confirmed stopped:`, result.stdout.trim().slice(-200));
 } catch (cleanupError) {
  logError("[DownloadAPI] Failed to stop remote direct download:", cleanupError);
 }
 return false;
}

/* ── Verified SFTP file transfer ───────────────────────── */

export function relayStagingFiles(taskId: string, remoteFilePath: string) {
 const operation = createHash("sha256").update(`${taskId}\0${remoteFilePath}`).digest("hex").slice(0, 24);
 const directory = shellQuote(path.posix.dirname(remoteFilePath));
 const prefix = `.vch-${operation}-`;
 return { prefix, cleanup: `if [ -d ${directory} ]; then find ${directory} -maxdepth 1 -type f -name ${shellQuote(prefix + "*.part")} -delete; fi` };
}

export async function transferFileViaSsh2(
 server: DownloadServer,
 localFilePath: string,
 remoteFilePath: string,
 taskId: string,
 signal?: AbortSignal,
 expectedSha256?: string,
 commit: (rename: () => Promise<void>) => Promise<void> = rename => rename(),
): Promise<void> {
 if (!server.hostKeySha256?.trim()) {
  throw new BusinessError(t("backend.downloads.hostKeyFingerprintRequiredForRelay"));
 }
 signal?.throwIfAborted();
 const expected = expectedSha256 ?? await hashTransferFile(localFilePath, signal);
 if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("Invalid relay file digest");
 const sshParams = await buildSshParamsFromServer(server, server.sshKey);
 const { prefix, cleanup: cleanStaging } = relayStagingFiles(taskId, remoteFilePath);
 const verified = await execRemoteCommand({ ...sshParams, signal, timeout: 120000,
  command: `command -v sha256sum >/dev/null || exit 127\nif [ ! -L ${shellQuote(remoteFilePath)} ] && [ -f ${shellQuote(remoteFilePath)} ] && [ "$(sha256sum -- ${shellQuote(remoteFilePath)} | cut -d ' ' -f 1)" = ${shellQuote(expected)} ]; then echo COMMITTED; fi` });
 if (verified.exitCode !== 0) throw new Error("Remote file verification failed");
 // Covers process death after rename but before the database commit, even
 // when the local relay temp file has already disappeared.
 if (verified.stdout.trim() === "COMMITTED") {
  await commit(async () => {});
  await execRemoteCommand({ ...sshParams, command: cleanStaging, timeout: 10000, signal });
  return;
 }
 const staging = path.posix.join(path.posix.dirname(remoteFilePath), `${prefix}${randomUUID()}.part`);
  const config = createVerifiedSshConfig({
   ...sshParams,
   enforceHostKeyPin: true,
  });
  const client = await connectSsh(config);
  try {
   await new Promise<void>((resolve, reject) => {
    client.sftp((err, sftp) => {
     if (err) return reject(err);
     const read = createReadStream(localFilePath, { signal });
     const write = sftp.createWriteStream(staging, { flags: "wx", mode: 0o644 });
     let settled = false;
     let idleTimer: NodeJS.Timeout | undefined;
     // Abort a stalled transfer (remote stops ACKing) so it can't hang forever —
     // there is no other wall-clock bound on this SFTP pipe. Reset on progress.
     const IDLE_TIMEOUT_MS = 120_000;
     const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      // Tear down BOTH ends on any exit path: a read error otherwise leaks the
      // remote SFTP write handle, and a write error leaves the local file
      // descriptor open until GC.
      try { read.destroy(); } catch { /* best-effort */ }
      try { write.destroy(); } catch { /* best-effort */ }
      if (error) reject(error);
      else resolve();
     };
     const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(
       () => finish(new Error(`SFTP transfer stalled (no progress for ${IDLE_TIMEOUT_MS / 1000}s)`)),
       IDLE_TIMEOUT_MS,
      );
     };
     read.on("error", (e: Error) => finish(e));
     write.on("error", (e: Error) => finish(e));
     read.on("data", resetIdle);
     write.on("close", () => finish());
     resetIdle();
     read.pipe(write);
    });
   });
   signal?.throwIfAborted();
   const checksum = await execRemoteCommand({ ...sshParams, signal, timeout: 120000,
    command: `[ ! -L ${shellQuote(staging)} ] && [ -f ${shellQuote(staging)} ] && [ "$(sha256sum -- ${shellQuote(staging)} | cut -d ' ' -f 1)" = ${shellQuote(expected)} ]` });
   if (checksum.exitCode !== 0) throw new Error("Relay file checksum failed");
   await commit(async () => {
    const published = await execRemoteCommand({ ...sshParams, signal, timeout: 15000,
     command: `set -e\n[ -f ${shellQuote(staging)} ] && [ ! -L ${shellQuote(staging)} ] || exit 1\nmv -fT -- ${shellQuote(staging)} ${shellQuote(remoteFilePath)}\n[ -f ${shellQuote(remoteFilePath)} ] && [ ! -L ${shellQuote(remoteFilePath)} ]` });
    if (published.exitCode !== 0) throw new Error("Relay file atomic publication failed");
   });
   await execRemoteCommand({ ...sshParams, command: cleanStaging, timeout: 10000, signal });
  } catch (error) {
   try { await execRemoteCommand({ ...sshParams, command: `rm -f -- ${shellQuote(staging)}`, timeout: 10000 }); }
   catch (cleanupError) { logError("[DownloadAPI] Failed to clean staging file:", cleanupError); }
   throw error;
  } finally {
   client.end();
  }
}

/* ── Temp directory cleanup ────────────────────────────── */

export async function cleanupTemp(tempDir: string) {
 try {
  await fs.rm(tempDir, { recursive: true, force: true });
 } catch (err) {
  logError("[DownloadAPI] Failed to cleanup temp dir:", err);
 }
}
