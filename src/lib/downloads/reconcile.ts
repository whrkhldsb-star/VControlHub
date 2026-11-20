import { relayContentStatus } from "@/lib/downloads/relay-status";
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
import { safeTaskFileStem, shellQuote } from "@/lib/downloads/remote-command";
import { ensureAria2Daemon, removeDownload } from "@/lib/aria2/service";
import { t } from "@/lib/i18n/service-translations";
import { rm } from "node:fs/promises";
import { relayTempDir } from "@/lib/runtime/platform-paths";
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
  | { state: "RUNNING"; completedBytes: string | null; totalBytes: string | null }
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
  pid: number | null;
  url: string;
  fileName: string | null;
  targetPath: string;
  sshParams: SshParams;
}): Promise<ProbeResult> {
  const stem = safeTaskFileStem(input.taskId);
  const pidFile = `/tmp/app-dl-${stem}.pid`;
  const exitFile = `${pidFile}.exit`;
  const resolvedName = input.fileName || deriveDownloadFileNameFromUrl(input.url) || "download";
  const outputPath = `${input.targetPath.replace(/\/$/, "")}/${resolvedName}`;
  const output = shellQuote(outputPath);
  const probeCommand = [
    `id=${shellQuote(stem)}`,
    'pat="\\\\.vch-$id\\\\.part"',
    `if [ -f ${shellQuote(exitFile)} ]; then`,
    "  status=$(cat " + shellQuote(exitFile) + " 2>/dev/null || echo 1)",
    `  if [ "$status" = 0 ] && [ -f ${output} ] && [ ! -L ${output} ] && size=$(stat -c %s -- ${output}); then`,
    `    printf '%s\\n' COMPLETED "$size" ${output}`,
    "  else echo FAILED; fi",
    'elif pgrep -f -- "$pat" >/dev/null 2>&1; then',
    "  echo RUNNING",
    `  partial=${output}.vch-"$id".part`,
    '  if [ -f "$partial" ] && [ ! -L "$partial" ]; then stat -c %s -- "$partial"; else echo 0; fi',
    `  tail -n 1 -- ${shellQuote(pidFile + ".total")} 2>/dev/null || true`,
    'elif [ "$?" -ne 1 ]; then echo UNKNOWN',
    "else",
    `  echo ${input.pid ? "FAILED" : "UNKNOWN"}`,
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
    if (size === null) return { state: "FAILED" };
    const resolvedFileName =
      input.fileName ||
      (resolvedPathLine ? resolvedPathLine.split("/").filter(Boolean).pop() ?? null : null) ||
      deriveDownloadFileNameFromUrl(input.url);
    return { state: "COMPLETED", size, resolvedFileName };
  }
  if (remoteState === "FAILED") return { state: "FAILED" };
  if (remoteState === "RUNNING") return {
    state: "RUNNING", completedBytes: /^\d+$/.test(sizeLine ?? "") ? sizeLine! : null,
    totalBytes: /^\d+$/.test(resolvedPathLine ?? "") ? resolvedPathLine! : null,
  };
  return { state: "UNKNOWN" };
}

/**
 * A relay task given up on takes its aria2 entry and the control-plane temp
 * directory (tens of GB for a torrent) with it (A5-04); only the executor's
 * own failure paths cleaned up before, and a crashed worker left both behind.
 */
export async function failRelayTask(task: { id: string; aria2Gid: string | null; updatedAt: Date }, errorMessage: string, includePending = false): Promise<boolean> {
  // A pending retry owns the staging directory too. The job recovery worker
  // resolves expired leases before the reconciler may take over.
  const failed = await prisma.$queryRaw<{ publishing: boolean }[]>`
    UPDATE download_tasks d SET status = 'FAILED', "errorMessage" = ${errorMessage.slice(0, 500)}, "updatedAt" = NOW()
    WHERE d.id = ${task.id} AND d."updatedAt" = ${task.updatedAt}
      AND (d.status = 'RUNNING' OR (${includePending} AND d.status = 'PENDING'))
      AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.type = 'download.execute'
        AND j.payload->>'taskId' = d.id AND j.status IN ('PENDING', 'RUNNING'))
    RETURNING d."transferManifest" IS NOT NULL AND d."transferManifest" <> 'null'::jsonb AS publishing`;
  const outcome = failed[0];
  if (!outcome) return false;
  // Published bytes may need reconciliation against the manifest.
  if (outcome.publishing) return true;
  if (task.aria2Gid) {
    try { await removeDownload(task.aria2Gid, true); } catch { /* best-effort: aria2 may not know the gid any more */ }
  }
  await rm(relayTempDir(task.id), { recursive: true, force: true }).catch(err => logError("[DownloadReconcile] relay cleanup failed:", err));
  return true;
}

async function failRunningTask(taskId: string, errorMessage: string): Promise<boolean> {
  const res = await prisma.downloadTask.updateMany({
    where: { id: taskId, status: "RUNNING" },
    data: { status: "FAILED", errorMessage: errorMessage.slice(0, 500) },
  });
  return res.count > 0;
}

export function directProgress(probe: Extract<ProbeResult, { state: "RUNNING" }>, task: { completedBytes?: string | null; updatedAt: Date }) {
  if (probe.completedBytes === null) return {};
  const elapsed = Math.max(1, Date.now() - task.updatedAt.getTime());
  const delta = BigInt(probe.completedBytes) - BigInt(task.completedBytes ?? "0");
  return {
    completedBytes: probe.completedBytes, ...(probe.totalBytes ? { totalBytes: probe.totalBytes } : {}),
    downloadSpeed: delta >= BigInt(0) ? String(delta * BigInt(1000) / BigInt(elapsed)) : "0",
  };
}

async function reconcileDirectTask(
  task: { id: string; url: string; fileName: string | null; targetPath: string; pid: number | null; updatedAt: Date; completedBytes: string | null; server: ReconcileServer },
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
      return (await failRunningTask(task.id, t("backend.downloads.reconcile.serverUnreachable"))) ? "failed" : "skipped";
    }
    return "skipped";
  }

  if (probe.state === "RUNNING") {
    // Seen alive: move the row out of the stale window so the next passes do not
    // open one SSH session per pass for the whole download (A5-05). The
    // unreachable deadline restarts from a confirmed-live probe, which is right.
    await prisma.downloadTask.updateMany({ where: { id: task.id, status: "RUNNING", updatedAt: task.updatedAt }, data: { ...directProgress(probe, task), updatedAt: new Date() } });
    return "running";
  }
  if (probe.state === "FAILED") {
    return (await failRunningTask(task.id, t("backend.downloads.reconcile.remoteProcessFailed"))) ? "failed" : "skipped";
  }
  if (probe.state === "UNKNOWN") {
    if (Date.now() - task.updatedAt.getTime() > UNREACHABLE_FAIL_MS) {
      return (await failRunningTask(task.id, t("backend.downloads.reconcile.indeterminate"))) ? "failed" : "skipped";
    }
    return "skipped";
  }
  // COMPLETED: finish the task the way a user refresh would have.
  const size = probe.size;
  return prisma.$transaction(async (tx) => {
  const claimed = await tx.downloadTask.updateMany({
    where: { id: task.id, status: "RUNNING" },
    data: {
      status: "COMPLETED",
      progress: t("backend.downloads.progress.completed"),
      ...(probe.resolvedFileName && !task.fileName ? { fileName: probe.resolvedFileName } : {}),
      ...(size != null ? { fileSize: size, totalBytes: size, completedBytes: size } : {}),
    },
  });
  if (claimed.count === 0) return "skipped";
  await indexDownloadedFileEntry({
    preserveRecycled: true,
    storageNode: task.server.storageNode,
    targetPath: task.targetPath,
    fileName: probe.resolvedFileName,
    size: size != null ? BigInt(size) : null,
  }, tx);
  return "completed" as const;
  });
}

type StaleTaskRow = Prisma.DownloadTaskGetPayload<{
  include: { server: { include: { sshKey: true; storageNode: true } } };
}>;
function failStaleTask(task: StaleTaskRow, message: string) {
  return task.relayMode || task.aria2Gid || task.agentStorageNodeId
    ? failRelayTask(task, message)
    : failRunningTask(task.id, message);
}

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
    status = (await relayContentStatus(task.aria2Gid)).status.status;
  } catch (err) {
    logError("[DownloadReconcile] relay tellStatus failed:", err);
    // aria2 no longer knows this gid (daemon restarted) — the download is gone.
    if (Date.now() - task.updatedAt.getTime() > UNREACHABLE_FAIL_MS) {
      return (await failRelayTask(task, t("backend.downloads.reconcile.relayLost"))) ? "failed" : "skipped";
    }
    return "skipped";
  }
  if (status === "error" || status === "removed") {
    return (await failRelayTask(task, t("backend.downloads.reconcile.relayFailed", { status }))) ? "failed" : "skipped";
  }
  if (status === "complete") {
    // aria2 finished but the worker died before/during the target-VPS transfer;
    // the transfer cannot be confirmed, so fail for a clean retry rather than
    // reporting a completion that never landed on the target.
    return (await failRelayTask(task, t("backend.downloads.reconcile.relayInterrupted"))) ? "failed" : "skipped";
  }
  // Still actively downloading in aria2 — leave it; killing wastes real progress.
  return "running";
}

/**
 * Where the last pass stopped in the (updatedAt, id) order of stale tasks
 * (process-local; a restart starts from the oldest again). Each pass takes the
 * next `limit` after it and wraps around, so every stale task is probed in
 * turn however long the backlog is. A fixed window of the oldest (even a
 * large one, rotated within) never reached the tasks behind it.
 */
let progressCursor: { updatedAt: Date; id: string } | null = null;
let reconcileCursor: { updatedAt: Date; id: string } | null = null;

/** Test hook: start the next pass from the oldest stale task. */
export function resetReconcileCursorForTests() {
  reconcileCursor = null;
}

// A task still "queued" this long with no job that could start it is orphaned
// (A5-03): its job failed before claiming it (bad payload, server deleted) and
// the pruner later took the job row, so nothing would ever touch the task.
const PENDING_ORPHAN_MS = 60 * 60_000;

async function failOrphanedPendingTasks(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - PENDING_ORPHAN_MS);
    return await prisma.$executeRaw`
      WITH orphans AS (
        SELECT d.id FROM download_tasks d
        WHERE d.status = 'PENDING' AND d."aria2Gid" IS NULL AND d."updatedAt" < ${cutoff}
          AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.type = 'download.execute'
            AND j.status IN ('PENDING', 'RUNNING') AND j.payload->>'taskId' = d.id)
        ORDER BY d."updatedAt", d.id LIMIT 50 FOR NO KEY UPDATE OF d SKIP LOCKED
      )
      UPDATE download_tasks d SET status = 'FAILED', "updatedAt" = ${new Date()},
        "errorMessage" = ${t("backend.downloads.reconcile.queuedWithoutJob")}
      FROM orphans WHERE d.id = orphans.id
    `;
  } catch (err) {
    logError("[DownloadReconcile] orphaned PENDING sweep failed:", err);
    return 0;
  }
}

export async function reconcileStaleRunningDownloadTasks(input?: {
  limit?: number;
  taskIds?: string[];
  directProgressOnly?: boolean;
}): Promise<{ completed: number; failed: number; ids: string[] }> {
  const limit = Math.min(Math.max(input?.limit ?? DEFAULT_LIMIT, 1), 100);
  const cutoff = new Date(Date.now() - (input?.directProgressOnly ? 10_000 : DIRECT_STALE_MS));
  const where = { status: "RUNNING" as const, updatedAt: { lt: cutoff }, ...(input?.directProgressOnly ? { relayMode: false, pid: { not: null } } : {}), ...(input?.taskIds ? { id: { in: input.taskIds } } : {}) };
  // updatedAt itself must not move while a task is probed: the unreachable
  // deadline counts from it, which also keeps this order stable.
  const order = [{ updatedAt: "asc" as const }, { id: "asc" as const }];
  const page = (after: { updatedAt: Date; id: string } | null, take: number) => prisma.downloadTask.findMany({
    where: after
      ? { AND: [where, { OR: [{ updatedAt: { gt: after.updatedAt } }, { updatedAt: after.updatedAt, id: { gt: after.id } }] }] }
      : where,
    select: { id: true, updatedAt: true },
    orderBy: order,
    take,
  });
  // Named tasks are probed as asked; the background pass walks the backlog.
  const cursor = input?.directProgressOnly ? progressCursor : input?.taskIds ? null : reconcileCursor;
  const ahead = await page(cursor, limit);
  const wrapped = cursor && ahead.length < limit
    ? (await page(null, limit - ahead.length)).filter((row) => !ahead.some((seen) => seen.id === row.id))
    : [];
  const chosenRows = [...ahead, ...wrapped];
  if (input?.directProgressOnly) progressCursor = chosenRows.at(-1) ?? null;
  else if (!input?.taskIds) reconcileCursor = chosenRows.at(-1) ?? null;
  const chosen = chosenRows.map((row) => row.id);
  const rows = chosen.length === 0 ? [] : await prisma.downloadTask.findMany({
    where: { ...where, id: { in: chosen } },
    include: { server: { include: { sshKey: true, storageNode: true } } },
    orderBy: { updatedAt: "asc" },
  });

  let completed = 0;
  let failed = 0;
  const ids: string[] = [];
  for (const task of rows) {
    try {
      if (!task.server) {
        if (Date.now() - task.updatedAt.getTime() > UNREACHABLE_FAIL_MS) {
          if (await failStaleTask(task, t("backend.downloads.reconcile.serverMissing"))) { failed++; ids.push(task.id); }
        }
        continue;
      }
      if (task.directStorageNodeId && task.server.storageNode?.id !== task.directStorageNodeId) {
        if (await failStaleTask(task, t("backend.downloads.taskStorageMissing"))) { failed++; ids.push(task.id); }
        continue;
      }
      let outcome: "completed" | "failed" | "running" | "skipped";
      if (task.aria2Gid) {
        outcome = await reconcileRelayTask({ id: task.id, aria2Gid: task.aria2Gid, updatedAt: task.updatedAt });
      } else if (!task.relayMode) {
        outcome = await reconcileDirectTask({
          id: task.id, url: task.url, fileName: task.fileName,
          targetPath: task.targetPath, pid: task.pid, updatedAt: task.updatedAt, completedBytes: task.completedBytes,
          server: task.server,
        });
      } else {
        // A relay without a durable gid cannot be assumed never to have started.
        // Direct tasks always inspect remote markers, including a missing DB pid.
        outcome = Date.now() - task.updatedAt.getTime() > UNREACHABLE_FAIL_MS
          ? ((await failRelayTask(task, t("backend.downloads.reconcile.neverStarted"))) ? "failed" : "skipped")
          : "skipped";
      }
      if (outcome === "completed") { completed++; ids.push(task.id); }
      else if (outcome === "failed") { failed++; ids.push(task.id); }
    } catch (err) {
      logError("[DownloadReconcile] task reconcile failed:", err);
    }
  }
  // The background pass also retires queued tasks nothing will ever start (after
  // the RUNNING scan, so the two reads never compete for the same page).
  const orphaned = input?.taskIds || input?.directProgressOnly ? 0 : await failOrphanedPendingTasks();
  return { completed, failed: failed + orphaned, ids };
}
