/**
 * Download execution strategies — aria2 relay and direct download.
 * Extracted from route.ts for maintainability.
 */

import { prisma } from "@/lib/db";
import { createLogger, logError } from "@/lib/logging";

const notifyLogger = createLogger("downloads-notify");
import { notifyDownloadResult } from "@/lib/notification/service";
import {
 ensureAria2Daemon,
 addUri,
 removeDownload,
 tellStatus,
 getPublicAria2Error,
} from "@/lib/aria2/service";
import { execRemoteCommand, buildSshParamsFromServer, connectSsh, createVerifiedSshConfig } from "@/lib/ssh/client";
import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import {
 buildDirectDownloadCommand,
 getDirectDownloadLogCommand,
 shellQuote,
 toRemoteChildPath,
} from "@/lib/downloads/remote-command";
import {
 indexDownloadedFileEntry,
 getPublicDownloadError,
 buildProgressText,
} from "@/lib/downloads/helpers";
import { BusinessError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import type { DownloadSourceResolution } from "@/lib/downloads/source-url";



async function loadDownloadTeamId(taskId: string): Promise<string | null> {
  const row = await prisma.downloadTask.findUnique({
    where: { id: taskId },
    select: { teamId: true },
  });
  return row?.teamId ?? null;
}

/* ── Shared server type ────────────────────────────────── */

export type DownloadServer = {
 host: string;
 port: number;
 username: string;
 connectionType?: string;
 sshKeyId: string | null;
 password: string | null;
 hostKeySha256?: string | null;
 storageNode?: { id: string; basePath: string | null } | null;
 sshKey?: { privateKey: string } | null;
};

/* ── Aria2 relay download ──────────────────────────────── */

export async function executeAria2RelayDownload(
 taskId: string,
 server: DownloadServer,
 urls: string[],
 targetPath: string,
 _fileName?: string | null,
 maxSpeedKb?: number | null,
 userId?: string,
 signal?: AbortSignal,
) {
 void _fileName;
 const tempDir = `/tmp/app-relay-${taskId}`;
 const teamId = await loadDownloadTeamId(taskId);

 let gid: string;
 try {
  // Claim BEFORE starting the aria2 download. Historically addUri ran first and
  // the PENDING→RUNNING CAS ran second: a retry (maxAttempts=3) or a concurrent
  // tick would then (1) spawn a *duplicate* aria2 download into the shared
  // tempDir and (2) on the CAS miss call cleanupTemp() — wiping the tempDir out
  // from under the still-active first download. Claiming first makes the side
  // effect exclusive to the winner; a loser resumes by the stored gid instead.
  const claimed = await prisma.downloadTask.updateMany({
   where: { id: taskId, status: "PENDING" },
   data: { status: "RUNNING", progress: "Relay download starting (aria2 RPC)..." },
  });

  await ensureAria2Daemon();

  if (claimed.count > 0) {
   // Fresh claim — we own this task; start the download.
   await fs.mkdir(tempDir, { recursive: true });

   const options: Record<string, string> = {
    dir: tempDir,
    "seed-time": "0",
    // Bound redirect following so enqueue-time DNS allowlist cannot be bypassed via long redirect chains.
    "max-redirect": "3",
   };
   if (maxSpeedKb) options["max-download-limit"] = `${maxSpeedKb}K`;

   gid = await addUri(urls, options);

   await prisma.downloadTask.updateMany({
    where: { id: taskId, status: "RUNNING" },
    data: { aria2Gid: gid, progress: "Relay download in progress (aria2 RPC)..." },
   });
  } else {
   // Not PENDING — a retry or concurrent tick. Resume the download already
   // started by the original dispatch (reuse its gid); never start a duplicate
   // and never wipe the shared tempDir a live sibling worker may be writing to.
   const current = await prisma.downloadTask.findUnique({
    where: { id: taskId },
    select: { status: true, aria2Gid: true },
   });
   if (!current || current.status !== "RUNNING" || !current.aria2Gid) {
    logError(
     `[DownloadAPI] Relay task ${taskId} not resumable (status=${current?.status ?? "missing"}, gid=${current?.aria2Gid ?? "none"}); skipping without touching tempDir`,
    );
    return;
   }
   gid = current.aria2Gid;
   await fs.mkdir(tempDir, { recursive: true });
  }

  let done = false;
  let elapsed = 0;
  const maxWait = 7200;

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
     select: { status: true },
    });
    if (!current || current.status === "CANCELLED" || current.status === "FAILED" || current.status === "COMPLETED") {
     try {
      await removeDownload(gid);
     } catch {
      /* best-effort */
     }
     await cleanupTemp(tempDir);
     return;
    }

    const st = await tellStatus(gid);
    const progress = buildProgressText(st);
    await prisma.downloadTask.updateMany({
     where: { id: taskId, status: "RUNNING" },
     data: { progress, completedBytes: st.completedLength, totalBytes: st.totalLength, downloadSpeed: st.downloadSpeed },
    });

    if (st.status === "complete") {
     done = true;
    } else if (st.status === "error" || st.status === "removed") {
     await prisma.downloadTask.updateMany({
      where: { id: taskId, status: "RUNNING" },
      data: { status: "FAILED", errorMessage: `aria2 download failed: ${st.status}` },
     });
     if (userId) notifyDownloadResult(userId, urls[0]!, "failed", `aria2 download failed: ${st.status}`, teamId).catch((err) => { notifyLogger.warn("notifyDownloadResult failed", { error: err instanceof Error ? err.message : String(err) }); });
     await cleanupTemp(tempDir);
     return;
     }
   } catch (err) {
    logError("[DownloadAPI] aria2 status poll failed:", err);
    await prisma.downloadTask.updateMany({
     where: { id: taskId, status: "RUNNING" },
     data: { status: "FAILED", errorMessage: t("backend.downloads.relayStatusVerificationFailed") },
    });
    if (userId) notifyDownloadResult(userId, urls[0]!, "failed", t("backend.downloads.relayStatusVerificationFailed"), teamId).catch((notifyError) => { notifyLogger.warn("notifyDownloadResult failed", { error: notifyError instanceof Error ? notifyError.message : String(notifyError) }); });
    try { await removeDownload(gid, true); } catch { /* best effort */ }
    await cleanupTemp(tempDir);
    return;
   }
  }

  if (!done) {
   try { await removeDownload(gid, true); } catch (err) { logError("[DownloadAPI] Failed to remove aria2 download on timeout:", err); }
   await prisma.downloadTask.updateMany({ where: { id: taskId, status: "RUNNING" }, data: { status: "FAILED", errorMessage: "Download timed out (2 hour limit)" } });
   if (userId) notifyDownloadResult(userId, urls[0]!, "failed", "Download timed out (2 hour limit)", teamId).catch((err) => { notifyLogger.warn("notifyDownloadResult failed", { error: err instanceof Error ? err.message : String(err) }); });
   await cleanupTemp(tempDir);
   return;
  }

  await prisma.downloadTask.updateMany({ where: { id: taskId, status: "RUNNING" }, data: { progress: "Download completed, transferring to target VPS..." } });

  const downloadedFiles = await fs.readdir(tempDir);
  const filesToTransfer = downloadedFiles.filter((f) => !f.endsWith(".aria2") && !f.startsWith("."));

  if (filesToTransfer.length === 0) {
   await prisma.downloadTask.updateMany({ where: { id: taskId, status: "RUNNING" }, data: { status: "FAILED", errorMessage: "Download completed but file not found" } });
   if (userId) notifyDownloadResult(userId, urls[0]!, "failed", "Download completed but file not found", teamId).catch((err) => { notifyLogger.warn("notifyDownloadResult failed", { error: err instanceof Error ? err.message : String(err) }); });
   await cleanupTemp(tempDir);
   return;
  }

  let totalSize = 0;
  for (const f of filesToTransfer) {
   try { const stat = await fs.stat(path.join(tempDir, f)); totalSize += stat.size; } catch (err) { logError("[DownloadAPI] Failed to stat file:", err); }
  }

  const sshParams = await buildSshParamsFromServer(server, server.sshKey);
  await execRemoteCommand({ ...sshParams, command: `mkdir -p -- ${shellQuote(targetPath)}`, timeout: 15000 });

  for (const file of filesToTransfer) {
   const localFilePath = path.join(tempDir, file);
   const remoteFilePath = toRemoteChildPath(targetPath, file);
   await transferFileViaSsh2(server, localFilePath, remoteFilePath, taskId);
  }

  for (const file of filesToTransfer) {
   const stat = await fs.stat(path.join(tempDir, file));
   await indexDownloadedFileEntry({ storageNode: server.storageNode, targetPath, fileName: file, size: stat.size });
  }

  await prisma.downloadTask.updateMany({
   where: { id: taskId, status: "RUNNING" },
   data: { status: "COMPLETED", progress: "Download and transfer completed", fileSize: String(totalSize), totalBytes: String(totalSize), completedBytes: String(totalSize) },
  });
  if (userId) notifyDownloadResult(userId, urls[0]!, "completed", undefined, teamId).catch((err) => { notifyLogger.warn("notifyDownloadResult failed", { error: err instanceof Error ? err.message : String(err) }); });

  await cleanupTemp(tempDir);
 } catch (error) {
  logError("[DownloadAPI] Relay download execution failed:", error);
  try {
   await prisma.downloadTask.updateMany({ where: { id: taskId, status: { in: ["PENDING", "RUNNING"] } }, data: { status: "FAILED", errorMessage: getPublicAria2Error(error) } });
   if (userId) notifyDownloadResult(userId, urls[0]!, "failed", getPublicAria2Error(error), teamId).catch((err) => { notifyLogger.warn("notifyDownloadResult failed", { error: err instanceof Error ? err.message : String(err) }); });
  } catch (err) { logError("[DownloadAPI] Failed to update task status after relay failure:", err); }
  await cleanupTemp(tempDir);
 }
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
) {
 const teamId = await loadDownloadTeamId(taskId);

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
   data: { status: "RUNNING", progress: "Starting download..." },
  });
  if (claimed.count === 0) {
   logError(`[DownloadAPI] Direct task ${taskId} was not PENDING; skipping duplicate remote spawn`);
   return;
  }

  const sshParams = await buildSshParamsFromServer(server, server.sshKey);
  await execRemoteCommand({ ...sshParams, command: `mkdir -p -- ${shellQuote(targetPath)}`, timeout: 15000 });

  const downloadCmd = buildDirectDownloadCommand({
   taskId,
   url,
   targetPath,
   fileName,
   sourceResolution,
  });
  const { stdout: pidOutput, exitCode } = await execRemoteCommand({ ...sshParams, command: downloadCmd, timeout: 30000 });
  const pid = parseInt(pidOutput.trim(), 10);

  if (exitCode === 0 && pid > 0) {
   // Record the pid on the row we already claimed to RUNNING above.
   await prisma.downloadTask.updateMany({
    where: { id: taskId, status: "RUNNING" },
    data: { pid, progress: "Downloading..." },
   });
   await indexDownloadedFileEntry({ storageNode: server.storageNode, targetPath, fileName, size: null });
  } else {
   const { stdout: logContent } = await execRemoteCommand({ ...sshParams, command: getDirectDownloadLogCommand(taskId), timeout: 8000 });
   const errMsg = logContent.trim() || "Failed to start download process";
   await prisma.downloadTask.updateMany({ where: { id: taskId, status: "RUNNING" }, data: { status: "FAILED", errorMessage: errMsg } });
   if (userId) notifyDownloadResult(userId, url, "failed", errMsg, teamId).catch((err) => { notifyLogger.warn("notifyDownloadResult failed", { error: err instanceof Error ? err.message : String(err) }); });
  }
 } catch (error) {
  logError("[DownloadAPI] Direct download execution failed:", error);
  try {
   await prisma.downloadTask.update({ where: { id: taskId }, data: { status: "FAILED", errorMessage: getPublicDownloadError(error) } });
   if (userId) notifyDownloadResult(userId, url, "failed", getPublicDownloadError(error), teamId).catch((err) => { notifyLogger.warn("notifyDownloadResult failed", { error: err instanceof Error ? err.message : String(err) }); });
  } catch (err) { logError("[DownloadAPI] Failed to update task status after direct download failure:", err); }
 }
}

/* ── Verified SFTP file transfer ───────────────────────── */

export async function transferFileViaSsh2(
 server: DownloadServer,
 localFilePath: string,
 remoteFilePath: string,
 taskId: string,
): Promise<void> {
 void taskId;
 if (!server.hostKeySha256?.trim()) {
  throw new BusinessError(t("backend.downloads.hostKeyFingerprintRequiredForRelay"));
 }
 const sshParams = await buildSshParamsFromServer(server, server.sshKey);
  const config = createVerifiedSshConfig({
   ...sshParams,
   enforceHostKeyPin: true,
  });
  const client = await connectSsh(config);
  try {
   await new Promise<void>((resolve, reject) => {
    client.sftp((err, sftp) => {
     if (err) return reject(err);
     const read = createReadStream(localFilePath);
     const write = sftp.createWriteStream(remoteFilePath);
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
