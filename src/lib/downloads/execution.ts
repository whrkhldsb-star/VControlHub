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
) {
 void _fileName;
 const tempDir = `/tmp/app-relay-${taskId}`;
 const teamId = await loadDownloadTeamId(taskId);

 try {
  await ensureAria2Daemon();
  await fs.mkdir(tempDir, { recursive: true });

  const options: Record<string, string> = {
   dir: tempDir,
   "seed-time": "0",
   // Bound redirect following so enqueue-time DNS allowlist cannot be bypassed via long redirect chains.
   "max-redirect": "3",
  };
  if (maxSpeedKb) options["max-download-limit"] = `${maxSpeedKb}K`;

  const gid = await addUri(urls, options);

  // CAS: only PENDING → RUNNING (cancel/other terminal must not flip back).
  const claimed = await prisma.downloadTask.updateMany({
   where: { id: taskId, status: "PENDING" },
   data: { aria2Gid: gid, status: "RUNNING", progress: "Relay download in progress (aria2 RPC)..." },
  });
  if (claimed.count === 0) {
   logError(`[DownloadAPI] Relay task ${taskId} was not PENDING; aborting after aria2 add`);
   try {
    await removeDownload(gid);
   } catch {
    /* best-effort */
   }
   await cleanupTemp(tempDir);
   return;
  }

  let done = false;
  let elapsed = 0;
  const maxWait = 7200;

  while (!done && elapsed < maxWait) {
   await new Promise((r) => setTimeout(r, 5000));
   elapsed += 5;

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
) {
 const teamId = await loadDownloadTeamId(taskId);

 try {
  const sshParams = await buildSshParamsFromServer(server, server.sshKey);
  await execRemoteCommand({ ...sshParams, command: `mkdir -p -- ${shellQuote(targetPath)}`, timeout: 15000 });

  const downloadCmd = buildDirectDownloadCommand({ taskId, url, targetPath, fileName });
  const { stdout: pidOutput, exitCode } = await execRemoteCommand({ ...sshParams, command: downloadCmd, timeout: 30000 });
  const pid = parseInt(pidOutput.trim(), 10);

  if (exitCode === 0 && pid > 0) {
   // FEAT-P1: CAS — only transition PENDING -> RUNNING
  const claimed = await prisma.downloadTask.updateMany({
    where: { id: taskId, status: "PENDING" },
    data: { pid, status: "RUNNING", progress: "Downloading..." },
  });
  if (claimed.count === 0) {
    logError(`[DownloadAPI] Task ${taskId} was not in PENDING state; killing orphan remote download`);
    // Process already spawned via nohup — stop it by pid file / pid.
    const safeTaskId = taskId.replace(/[^A-Za-z0-9_-]/g, "_");
    const pidFile = `/tmp/app-dl-${safeTaskId}.pid`;
    try {
      await execRemoteCommand({
        ...sshParams,
        command: `kill ${pid} 2>/dev/null; kill -9 ${pid} 2>/dev/null; rm -f -- ${shellQuote(pidFile)} ${shellQuote(pidFile + ".exit")} 2>/dev/null; true`,
        timeout: 10000,
      });
    } catch (err) {
      logError("[DownloadAPI] Failed to kill orphan remote download after CAS miss:", err);
    }
    return;
  }
   await indexDownloadedFileEntry({ storageNode: server.storageNode, targetPath, fileName, size: null });
  } else {
   const { stdout: logContent } = await execRemoteCommand({ ...sshParams, command: getDirectDownloadLogCommand(taskId), timeout: 8000 });
   const errMsg = logContent.trim() || "Failed to start download process";
   await prisma.downloadTask.update({ where: { id: taskId }, data: { status: "FAILED", errorMessage: errMsg } });
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
     read.on("error", reject);
     write.on("error", reject);
     write.on("close", () => resolve());
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
