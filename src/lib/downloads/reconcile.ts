/**
 * Background reconciliation for RUNNING DownloadTasks.
 *
 * Direct downloads run as a remote `nohup curl` (see remote-command.ts); their
 * DownloadTask row is ONLY advanced to a terminal state when a user manually
 * PATCHes `action:"refresh"` (route-patch.ts). If the user closes the tab, the
 * remote transfer finishes but the row stays RUNNING forever. Relay downloads
 * are polled in-process by the worker every 5s, so a stale row means the worker
 * died mid-run. Neither path has a background reaper — this closes that gap.
 *
 * The reconciler NEVER guesses from `updatedAt` alone (a large direct download
 * nobody is watching legitimately has a stale row while curl is still running).
 * It probes the real remote state — the same pid/exit-file probe route-patch
 * uses, and the same aria2 tellStatus route-get uses — and only transitions on
 * a definitive answer, or fails a task the remote can no longer account for
 * after a generous unreachable window.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/logging";
import { execRemoteCommand, buildSshParamsFromServer } from "@/lib/ssh/client";
import { shellQuote } from "@/lib/downloads/remote-command";
import { ensureAria2Daemon, tellStatus } from "@/lib/aria2/service";
import { deriveDownloadFileNameFromUrl, indexDownloadedFileEntry } from "@/lib/downloads/helpers";

// Don't touch a row an open UI is actively refreshing (route-patch bumps
// updatedAt on every refresh). Past this, no one is watching.
const DIRECT_STALE_MS = 15 * 60_000;
// A live relay worker rewrites progress every 5s while downloading; well past
// the 2h download cap (executeAria2RelayDownload maxWait=7200s) a still-RUNNING
// row means the worker is gone.
const RELAY_STALE_MS = 3 * 60 * 60_000;
// If the remote can't be reached (SSH/aria2 down) for this long, stop waiting.
const UNREACHABLE_FAIL_MS = 6 * 60 * 60_000;
const DEFAULT_LIMIT = 20;

type ProbeResult =
  | { state: "COMPLETED"; size: string | null; resolvedFileName: string | null }
  | { state: "FAILED" }
  | { state: "RUNNING" }
  | { state: "UNKNOWN" };

type SshParams = Awaited<ReturnType<typeof buildSshParamsFromServer>>;

/**
 * Probe a direct download's remote process/exit marker. Shared with the
 * user-triggered refresh in route-patch.ts so the two paths cannot diverge.
 * Returns COMPLETED/FAILED on a definitive exit marker, RUNNING while the pid
 * is alive, and UNKNOWN if the remote answer is unparseable.
 */
export async function probeDirectDownloadRemote(input: {
  taskId: string;
  pid: number;
  url: string;
  fileName: string | null;
  targetPath: string;
  sshParams: SshParams;
}): Promise<ProbeResult> {
  const safeTaskFileStem = input.taskId.replace(/[^A-Za-z0-9_-]/g, "_");
  const pidFile = `/tmp/app-dl-${safeTaskFileStem}.pid`;
  const exitFile = `${pidFile}.exit`;
  const outputPath = input.fileName
    ? `${input.targetPath.replace(/\/$/, "")}/${input.fileName}`
    : "";
  const statSnippet = outputPath
    ? `if [ -f ${shellQuote(outputPath)} ]; then stat -c %s -- ${shellQuote(outputPath)} 2>/dev/null || echo 0; else echo 0; fi`
    : "echo 0";
  const probeCommand = [
    `if [ -f ${shellQuote(exitFile)} ]; then`,
    "  status=$(cat " + shellQuote(exitFile) + " 2>/dev/null || echo 1)",
    '  if [ "$status" = "0" ]; then echo COMPLETED; else echo FAILED; fi',
    `  ${statSnippet}`,
    outputPath ? `  echo ${shellQuote(outputPath)}` : "  echo",
    `elif kill -0 ${input.pid} 2>/dev/null; then`,
    "  echo RUNNING",
    "  echo 0",
    "else",
    "  echo FAILED",
    "  echo 0",
    "fi",
  ].join("\n");

  const { stdout } = await execRemoteCommand({
    ...input.sshParams,
    command: probeCommand,
    timeout: 10000,
  });
  const [remoteState, sizeLine, resolvedPathLine] = stdout.trim().split(/\r?\n/);
  if (remoteState === "COMPLETED") {
    const size = /^\d+$/.test(sizeLine ?? "") ? sizeLine ?? null : null;
    const resolvedFileName =
      input.fileName ||
      (resolvedPathLine ? resolvedPathLine.split("/").filter(Boolean).pop() ?? null : null) ||
      deriveDownloadFileNameFromUrl(input.url);
    return { state: "COMPLETED", size, resolvedFileName };
  }
  if (remoteState === "FAILED") return { state: "FAILED" };
  if (remoteState === "RUNNING") return { state: "RUNNING" };
  return { state: "UNKNOWN" };
}

async function failRunningTask(taskId: string, errorMessage: string): Promise<boolean> {
  const res = await prisma.downloadTask.updateMany({
    where: { id: taskId, status: "RUNNING" },
    data: { status: "FAILED", errorMessage: errorMessage.slice(0, 500) },
  });
  return res.count > 0;
}

async function reconcileDirectTask(
  task: { id: string; url: string; fileName: string | null; targetPath: string; pid: number; updatedAt: Date; server: ReconcileServer },
): Promise<"completed" | "failed" | "running" | "skipped"> {
  const sshParams = await buildSshParamsFromServer(task.server, task.server.sshKey);
  let probe: ProbeResult;
  try {
    probe = await probeDirectDownloadRemote({
      taskId: task.id,
      pid: task.pid,
      url: task.url,
      fileName: task.fileName,
      targetPath: task.targetPath,
      sshParams,
    });
  } catch (err) {
    logError("[DownloadReconcile] direct probe failed:", err);
    // Remote unreachable — only give up after a generous window so a transient
    // SSH blip never fails an in-flight download.
    if (Date.now() - task.updatedAt.getTime() > UNREACHABLE_FAIL_MS) {
      return (await failRunningTask(task.id, "Download server unreachable; abandoned")) ? "failed" : "skipped";
    }
    return "skipped";
  }

  if (probe.state === "RUNNING") return "running";
  if (probe.state === "FAILED") {
    return (await failRunningTask(task.id, "Remote download process failed")) ? "failed" : "skipped";
  }
  if (probe.state === "UNKNOWN") {
    if (Date.now() - task.updatedAt.getTime() > UNREACHABLE_FAIL_MS) {
      return (await failRunningTask(task.id, "Download state indeterminate; abandoned")) ? "failed" : "skipped";
    }
    return "skipped";
  }
  // COMPLETED: finish the task the way a user refresh would have.
  const size = probe.size;
  const claimed = await prisma.downloadTask.updateMany({
    where: { id: task.id, status: "RUNNING" },
    data: {
      status: "COMPLETED",
      progress: "Download completed",
      ...(probe.resolvedFileName && !task.fileName ? { fileName: probe.resolvedFileName } : {}),
      ...(size ? { fileSize: size, totalBytes: size, completedBytes: size } : {}),
    },
  });
  if (claimed.count === 0) return "skipped";
  await indexDownloadedFileEntry({
    storageNode: task.server.storageNode,
    targetPath: task.targetPath,
    fileName: probe.resolvedFileName,
    size: size ? BigInt(size) : null,
  });
  return "completed";
}

type StaleTaskRow = Prisma.DownloadTaskGetPayload<{
  include: { server: { include: { sshKey: true; storageNode: true } } };
}>;
type ReconcileServer = NonNullable<StaleTaskRow["server"]>;

async function reconcileRelayTask(
  task: { id: string; aria2Gid: string; updatedAt: Date },
): Promise<"failed" | "running" | "skipped"> {
  // A live relay worker rewrites progress every 5s; only act once the row is
  // far past the 2h download cap so an in-flight transfer is never killed.
  if (Date.now() - task.updatedAt.getTime() < RELAY_STALE_MS) return "skipped";
  let status: string;
  try {
    await ensureAria2Daemon();
    status = (await tellStatus(task.aria2Gid)).status;
  } catch (err) {
    logError("[DownloadReconcile] relay tellStatus failed:", err);
    // aria2 no longer knows this gid (daemon restarted) — the download is gone.
    if (Date.now() - task.updatedAt.getTime() > UNREACHABLE_FAIL_MS) {
      return (await failRunningTask(task.id, "Relay download lost (aria2 no longer tracking); retry")) ? "failed" : "skipped";
    }
    return "skipped";
  }
  if (status === "error" || status === "removed") {
    return (await failRunningTask(task.id, `Relay download failed: ${status}`)) ? "failed" : "skipped";
  }
  if (status === "complete") {
    // aria2 finished but the worker died before/during the target-VPS transfer;
    // the transfer cannot be confirmed, so fail for a clean retry rather than
    // reporting a completion that never landed on the target.
    return (await failRunningTask(task.id, "Relay worker interrupted after download; retry")) ? "failed" : "skipped";
  }
  // Still actively downloading in aria2 — leave it; killing wastes real progress.
  return "running";
}

export async function reconcileStaleRunningDownloadTasks(input?: {
  limit?: number;
}): Promise<{ completed: number; failed: number; ids: string[] }> {
  const limit = Math.min(Math.max(input?.limit ?? DEFAULT_LIMIT, 1), 100);
  const cutoff = new Date(Date.now() - DIRECT_STALE_MS);
  const rows = await prisma.downloadTask.findMany({
    where: { status: "RUNNING", updatedAt: { lt: cutoff } },
    include: { server: { include: { sshKey: true, storageNode: true } } },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });

  let completed = 0;
  let failed = 0;
  const ids: string[] = [];
  for (const task of rows) {
    try {
      if (!task.server) {
        if (Date.now() - task.updatedAt.getTime() > UNREACHABLE_FAIL_MS) {
          if (await failRunningTask(task.id, "Download server missing; abandoned")) { failed++; ids.push(task.id); }
        }
        continue;
      }
      let outcome: "completed" | "failed" | "running" | "skipped";
      if (task.aria2Gid) {
        outcome = await reconcileRelayTask({ id: task.id, aria2Gid: task.aria2Gid, updatedAt: task.updatedAt });
      } else if (task.pid) {
        outcome = await reconcileDirectTask({
          id: task.id, url: task.url, fileName: task.fileName,
          targetPath: task.targetPath, pid: task.pid, updatedAt: task.updatedAt,
          server: task.server,
        });
      } else {
        // Claimed RUNNING but neither pid nor gid recorded — worker died in the
        // pre-side-effect window. Nothing ever started; fail once very stale.
        outcome = Date.now() - task.updatedAt.getTime() > UNREACHABLE_FAIL_MS
          ? ((await failRunningTask(task.id, "Download never started (worker lost); retry")) ? "failed" : "skipped")
          : "skipped";
      }
      if (outcome === "completed") { completed++; ids.push(task.id); }
      else if (outcome === "failed") { failed++; ids.push(task.id); }
    } catch (err) {
      logError("[DownloadReconcile] task reconcile failed:", err);
    }
  }
  return { completed, failed, ids };
}
