import path from "node:path/posix";
import { rm } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { forgetDownload } from "@/lib/aria2/service";
import { logError } from "@/lib/logging";
import { relayTempDir } from "@/lib/runtime/platform-paths";
import { createAgentFileClient } from "@/lib/storage/agent-file-client";
import { lockStorageFileOverwrite } from "@/lib/storage/file-overwrite-lock";
import { assertRemotePathContained } from "@/lib/storage/remote-containment";
import { execRemoteCommand } from "@/lib/ssh/client";
import { resolveBoundDownloadEndpoint, relayStagingFiles } from "./execution";
import { indexDownloadedFileEntry } from "./helpers";
import { shellQuote } from "./remote-command";
import { resolveTaskDrive } from "./destination";
import { getDownloadTargetRelativePath, resolveDownloadTargetPath } from "./target-path";
import { parseTransferManifest, relayCleanupConfirmed, relayMetadataGid, RELAY_PAUSE_MS } from "./transfer-manifest";
import { t } from "@/lib/i18n/service-translations";

/** Terminal rows are the durable cleanup queue. The receipt is committed last, after all side effects. */
export async function reconcileTerminalRelay(id: string) {
  const row = await prisma.downloadTask.findFirst({
    where: { id, status: { in: ["COMPLETED", "FAILED", "CANCELLED"] } },
    include: { server: { include: { sshKey: true, storageNode: true, agentFileShares: { select: { node: true } } } } },
  });
  if (!row) return false;
  if (relayCleanupConfirmed(row.transferManifest)) return true;
  const task = resolveTaskDrive(row);
  const active = await prisma.job.count({ where: { type: "download.execute", status: { in: ["PENDING", "RUNNING"] },
    payload: { path: ["taskId"], equals: id } } });
  if (active) return false;
  const manifest = parseTransferManifest(task.transferManifest);
  // COMPLETED already committed every index. A partially published failure only
  // repairs files whose on-disk digest matches. Never republish on a revoked grant.
  if (manifest && task.status !== "COMPLETED") {
    const node = task.server.storageNode;
    if (!node || !task.server.enabled || node.teamId !== task.teamId || task.server.teamId !== task.teamId) throw new Error("Relay binding changed");
    const agent = !!task.agentStorageNodeId;
    if (agent && (!task.agentRootIdentity || manifest.agentRootIdentity !== task.agentRootIdentity || node.driver !== "AGENT")) throw new Error("Relay root changed");
    if (!agent && node.driver !== "SFTP") throw new Error("Relay drive changed");
    for (const file of manifest.files) {
      const base = agent ? "/" : resolveDownloadTargetPath(node.basePath, "");
      const target = path.join(task.targetPath, file.name);
      const relative = getDownloadTargetRelativePath(base, target);
      const unlock = await lockStorageFileOverwrite(node.id, relative);
      try {
        let matches: boolean;
        if (agent) {
          matches = await createAgentFileClient(node.id, task.serverId, task.agentRootIdentity!).matches(relative, file.size, file.sha256);
        } else {
          const ssh = resolveBoundDownloadEndpoint({ ...node, server: task.server });
          if (!ssh.hostKeySha256) throw new Error("Missing relay endpoint pin");
          const physical = await assertRemotePathContained(ssh, base, target);
          const result = await execRemoteCommand({ ...ssh, timeout: 120_000, command: [
            relayStagingFiles(id, physical).cleanup + " || exit 1",
            `f=${shellQuote(physical)}`,
            'if [ ! -e "$f" ]; then echo ABSENT; exit 0; fi',
            '[ -f "$f" ] && [ ! -L "$f" ] || { echo DIFFERENT; exit 0; }',
            'sha256sum < "$f" || exit 1',
          ].join("\n") });
          if (result.exitCode !== 0) throw new Error("Cannot verify relay file");
          matches = result.stdout.trim().split(/\s+/)[0] === file.sha256;
        }
        if (!matches) continue;
        await prisma.$transaction(async tx => {
          const binding = await tx.$queryRaw<{ id: string }[]>`
            SELECT n.id FROM "StorageNode" n JOIN servers s ON s.id = ${task.serverId}
            WHERE n.id = ${node.id} AND n."teamId" IS NOT DISTINCT FROM ${task.teamId}
              AND s."teamId" IS NOT DISTINCT FROM n."teamId" AND s.enabled
              AND n."basePath" = ${node.basePath} AND n.driver::text = ${node.driver}
              AND s.host = ${task.server.host} AND s.port = ${task.server.port} AND s.username = ${task.server.username}
              AND n.host IS NOT DISTINCT FROM ${node.host} AND n.port IS NOT DISTINCT FROM ${node.port}
              AND n.username IS NOT DISTINCT FROM ${node.username} AND n."hostKeySha256" IS NOT DISTINCT FROM ${node.hostKeySha256}
              AND s."hostKeySha256" IS NOT DISTINCT FROM ${task.server.hostKeySha256}
              AND (n."serverId" = s.id OR ${agent}) FOR SHARE OF n, s`;
          if (!binding.length) throw new Error("Relay binding changed");
          if (agent && !(await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM agent_file_shares WHERE "serverId" = ${task.serverId}
              AND "storageNodeId" = ${node.id} AND "rootIdentity" = ${task.agentRootIdentity} FOR SHARE`).length) throw new Error("Relay root changed");
          await indexDownloadedFileEntry({ storageNode: { id: node.id, basePath: base }, targetPath: path.dirname(target),
            fileName: path.basename(target), size: file.size, preserveRecycled: true }, tx);
        });
      } finally { await unlock(); }
    }
  }
  const visited = new Set<string>();
  if (task.aria2Gid) await forgetDownload(task.aria2Gid, visited);
  const metadata = relayMetadataGid(task.transferManifest);
  if (metadata) await forgetDownload(metadata, visited);
  await rm(relayTempDir(id), { recursive: true, force: true });
  const changed = await prisma.downloadTask.updateMany({
    where: { id, status: task.status, updatedAt: task.updatedAt },
    data: { aria2Gid: null, transferManifest: { ...manifest, cleanupComplete: true } },
  });
  return changed.count > 0;
}

let cleanupCursor = "";
export async function sweepTerminalRelays() {
  const now = Date.now();
  await prisma.$executeRaw`
    UPDATE download_tasks SET status = 'FAILED', "updatedAt" = NOW(), "errorMessage" = ${t("backend.downloads.relayPausedTooLong")}
    WHERE status = 'PENDING' AND "aria2Gid" IS NOT NULL AND
      CASE WHEN jsonb_typeof("transferManifest"->'pausedUntil') = 'number'
        THEN ("transferManifest"->>'pausedUntil')::numeric <= ${now}
        ELSE "updatedAt" < ${new Date(now - RELAY_PAUSE_MS)} END`;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT d.id FROM download_tasks d
    WHERE d.status IN ('FAILED', 'CANCELLED', 'COMPLETED') AND d.id > ${cleanupCursor}
      AND (d."relayMode" OR d."agentStorageNodeId" IS NOT NULL OR d."aria2Gid" IS NOT NULL OR d."transferManifest" IS NOT NULL)
      AND (d."transferManifest"->>'cleanupComplete') IS DISTINCT FROM 'true'
      AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.type = 'download.execute' AND j.payload->>'taskId' = d.id AND j.status IN ('PENDING','RUNNING'))
    ORDER BY d.id LIMIT 20`;
  cleanupCursor = rows.length === 20 ? rows.at(-1)!.id : "";
  for (const row of rows) {
    try { await reconcileTerminalRelay(row.id); }
    catch (error) { logError("[DownloadReconcile] terminal relay cleanup pending", error); }
  }
}
