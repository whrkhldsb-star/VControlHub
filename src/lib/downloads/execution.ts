/**
 * Download execution strategies — aria2 relay and direct download.
 * Extracted from route.ts for maintainability.
 */

import { prisma } from "@/lib/db";
import { logError } from "@/lib/logging";
import { notifyDownloadResult } from "@/lib/notification/service";
import {
 ensureAria2Daemon,
 addUri,
 removeDownload,
 tellStatus,
 getPublicAria2Error,
} from "@/lib/aria2/service";
import { execRemoteCommand, buildSshParamsFromServer } from "@/lib/ssh/client";
import { decryptServerPassword, decryptSshPrivateKey } from "@/lib/ssh/ssh-key-crypto";
import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import {
 buildDirectDownloadCommand,
 getDirectDownloadLogCommand,
 shellQuote,
 toRemoteChildPath,
 toScpTarget,
} from "@/lib/downloads/remote-command";
import {
 indexDownloadedFileEntry,
 getPublicDownloadError,
 buildProgressText,
} from "@/lib/downloads/helpers";

const execFileAsync = promisify(execFile);

/* ── Shared server type ────────────────────────────────── */

export type DownloadServer = {
 host: string;
 port: number;
 username: string;
 sshKeyId: string | null;
 password: string | null;
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

 try {
  await ensureAria2Daemon();
  await fs.mkdir(tempDir, { recursive: true });

  const options: Record<string, string> = {
   dir: tempDir,
   "seed-time": "0",
  };
  if (maxSpeedKb) options["max-download-limit"] = `${maxSpeedKb}K`;

  const gid = await addUri(urls, options);

  await prisma.downloadTask.update({
   where: { id: taskId },
   data: { aria2Gid: gid, status: "RUNNING", progress: "中转下载中（aria2 RPC）..." },
  });

  let done = false;
  let elapsed = 0;
  const maxWait = 7200;

  while (!done && elapsed < maxWait) {
   await new Promise((r) => setTimeout(r, 5000));
   elapsed += 5;

   try {
    const st = await tellStatus(gid);
    const progress = buildProgressText(st);
    await prisma.downloadTask.update({
     where: { id: taskId },
     data: { progress, completedBytes: st.completedLength, totalBytes: st.totalLength, downloadSpeed: st.downloadSpeed },
    });

    if (st.status === "complete") {
     done = true;
    } else if (st.status === "error" || st.status === "removed") {
     await prisma.downloadTask.update({
      where: { id: taskId },
      data: { status: "FAILED", errorMessage: `aria2 下载失败: ${st.status}` },
     });
     if (userId) notifyDownloadResult(userId, urls[0], "failed", `aria2 下载失败: ${st.status}`).catch(() => {});
     await cleanupTemp(tempDir);
     return;
    }
   } catch (err) {
    logError("[DownloadAPI] aria2 status poll failed:", err);
    try {
     const files = await fs.readdir(tempDir);
     if (files.some((f) => !f.endsWith(".aria2"))) done = true;
    } catch (err2) {
     logError("[DownloadAPI] Failed to read temp dir:", err2);
    }
   }
  }

  if (!done) {
   try { await removeDownload(gid, true); } catch (err) { logError("[DownloadAPI] Failed to remove aria2 download on timeout:", err); }
   await prisma.downloadTask.update({ where: { id: taskId }, data: { status: "FAILED", errorMessage: "下载超时（2小时限制）" } });
   if (userId) notifyDownloadResult(userId, urls[0], "failed", "下载超时（2小时限制）").catch(() => {});
   await cleanupTemp(tempDir);
   return;
  }

  await prisma.downloadTask.update({ where: { id: taskId }, data: { progress: "下载完成，正在传输到目标 VPS..." } });

  const downloadedFiles = await fs.readdir(tempDir);
  const filesToTransfer = downloadedFiles.filter((f) => !f.endsWith(".aria2") && !f.startsWith("."));

  if (filesToTransfer.length === 0) {
   await prisma.downloadTask.update({ where: { id: taskId }, data: { status: "FAILED", errorMessage: "下载完成但未找到文件" } });
   if (userId) notifyDownloadResult(userId, urls[0], "failed", "下载完成但未找到文件").catch(() => {});
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

  if (filesToTransfer.length === 1) {
   await indexDownloadedFileEntry({ storageNode: server.storageNode, targetPath, fileName: filesToTransfer[0], size: totalSize });
  }

  await prisma.downloadTask.update({
   where: { id: taskId },
   data: { status: "COMPLETED", progress: "下载并传输完成", fileSize: String(totalSize), totalBytes: String(totalSize), completedBytes: String(totalSize) },
  });
  if (userId) notifyDownloadResult(userId, urls[0], "completed").catch(() => {});

  await cleanupTemp(tempDir);
 } catch (error) {
  logError("[DownloadAPI] Relay download execution failed:", error);
  try {
   await prisma.downloadTask.update({ where: { id: taskId }, data: { status: "FAILED", errorMessage: getPublicAria2Error(error) } });
   if (userId) notifyDownloadResult(userId, urls[0], "failed", getPublicAria2Error(error)).catch(() => {});
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
 try {
  const sshParams = await buildSshParamsFromServer(server, server.sshKey);
  await execRemoteCommand({ ...sshParams, command: `mkdir -p -- ${shellQuote(targetPath)}`, timeout: 15000 });

  const downloadCmd = buildDirectDownloadCommand({ taskId, url, targetPath, fileName });
  const { stdout: pidOutput, exitCode } = await execRemoteCommand({ ...sshParams, command: downloadCmd, timeout: 30000 });
  const pid = parseInt(pidOutput.trim(), 10);

  if (exitCode === 0 && pid > 0) {
   await indexDownloadedFileEntry({ storageNode: server.storageNode, targetPath, fileName, size: null });
   await prisma.downloadTask.update({ where: { id: taskId }, data: { pid, status: "RUNNING", progress: "下载中..." } });
  } else {
   const { stdout: logContent } = await execRemoteCommand({ ...sshParams, command: getDirectDownloadLogCommand(taskId), timeout: 8000 });
   const errMsg = logContent.trim() || "无法启动下载进程";
   await prisma.downloadTask.update({ where: { id: taskId }, data: { status: "FAILED", errorMessage: errMsg } });
   if (userId) notifyDownloadResult(userId, url, "failed", errMsg).catch(() => {});
  }
 } catch (error) {
  logError("[DownloadAPI] Direct download execution failed:", error);
  try {
   await prisma.downloadTask.update({ where: { id: taskId }, data: { status: "FAILED", errorMessage: getPublicDownloadError(error) } });
   if (userId) notifyDownloadResult(userId, url, "failed", getPublicDownloadError(error)).catch(() => {});
  } catch (err) { logError("[DownloadAPI] Failed to update task status after direct download failure:", err); }
 }
}

/* ── SCP file transfer ─────────────────────────────────── */

export async function transferFileViaSsh2(
 server: DownloadServer,
 localFilePath: string,
 remoteFilePath: string,
 taskId: string,
): Promise<void> {
 const scpArgs = ["-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-P", String(server.port || 22)];
 const target = toScpTarget(server.username || "root", server.host, remoteFilePath);

 if (decryptSshPrivateKey(server.sshKey?.privateKey ?? "")) {
  const keyFile = path.join("/tmp", `app-key-${taskId}-${randomUUID()}`);
  await fs.writeFile(keyFile, decryptSshPrivateKey(server.sshKey!.privateKey!), { mode: 0o600 });
  try {
   await execFileAsync("scp", [...scpArgs, "-i", keyFile, localFilePath, target], { timeout: 600_000, maxBuffer: 50 * 1024 * 1024 });
  } finally {
   await fs.unlink(keyFile).catch(() => {});
  }
 } else if (server.password) {
  const sshpassEnv = { ...process.env, SSHPASS: decryptServerPassword(server.password) };
  await execFileAsync("sshpass", ["-e", "scp", ...scpArgs, localFilePath, target], { timeout: 600_000, maxBuffer: 50 * 1024 * 1024, env: sshpassEnv });
 } else {
  throw new Error("No SSH key or password for file transfer");
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
