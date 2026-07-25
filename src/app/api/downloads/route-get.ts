import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/logging";
import { ensureAria2Daemon, tellStatus, getGlobalStat } from "@/lib/aria2/service";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { buildProgressText } from "@/lib/downloads/helpers";
import { withApiRoute } from "@/lib/http/api-guard";
import { AuthError } from "@/lib/errors";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { teamWhere } from "@/lib/auth/team-scope";
import { canAccessDownloadTask, taskDownloadAccess } from "@/lib/downloads/route-helpers";

/* ── GET: List tasks with real-time aria2 progress ────────── */

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: t("apiDownloads.fetchTasksFailed", "zh") },
    async ({ session }) => {
      const locale = await getServerLocale();
      if (!session)
        throw new AuthError(t("apiDownloads.unauthorized", locale));
      const { serverId, category } = parseSearchParams(
        request,
        z.object({
          serverId: z.string().trim().min(1).optional(),
          category: z.string().trim().min(1).optional(),
        }),
      );

      // Team prefilter first (perf + defense if ownership/storage ACL misses team);
      // canAccessDownloadTask still applies creator/storage ACL on the reduced set.
      const where: Record<string, unknown> = { ...teamWhere(session) };
      if (serverId) where.serverId = serverId;
      if (category) where.category = category;

      const tasks = await prisma.downloadTask.findMany({
        where,
        include: {
          server: { select: { id: true, name: true, host: true, storageNode: { select: { id: true, basePath: true, driver: true, host: true, port: true, directAccessMode: true, publicBaseUrl: true, directAccessExpiresSeconds: true } } } },
          creator: { select: { id: true, username: true, displayName: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });

      // Parallel ACL checks (still bounded by take:200) — sequential awaits made
      // list latency grow linearly with storage ACL DB hits.
      const accessFlags = await Promise.all(
        tasks.map((task) => canAccessDownloadTask({ session, task, operation: "read" })),
      );
      const visibleTasks = tasks.filter((_, i) => accessFlags[i]);

      const activeGids = new Map<string, string>();
      for (const t of visibleTasks) {
        if (t.aria2Gid && ["PENDING", "RUNNING"].includes(t.status)) {
          activeGids.set(t.aria2Gid, t.id);
        }
      }
      // Merge live aria2 fields into the in-memory rows so this response reflects
      // COMPLETED/FAILED/progress written below (avoid one-poll lag).
      type Aria2LiveFields = {
        status?: "COMPLETED" | "FAILED";
        progress?: string;
        errorMessage?: string;
        completedBytes?: number | null;
        totalBytes?: number | null;
        downloadSpeed?: number | null;
      };
      const aria2FieldByTaskId = new Map<string, Aria2LiveFields>();
      const toByteCount = (value: unknown): number | null => {
        if (value == null || value === "") return null;
        const n = typeof value === "number" ? value : Number(value);
        return Number.isFinite(n) ? n : null;
      };
      let aria2Available = false;
      if (activeGids.size > 0) {
        try {
          await ensureAria2Daemon();
          aria2Available = true;
          const updates: Promise<unknown>[] = [];
          for (const [gid, taskId] of activeGids) {
            updates.push(
              tellStatus(gid).then((a) => {
                const progress = buildProgressText(a);
                const completedBytes = toByteCount(a.completedLength);
                const totalBytes = toByteCount(a.totalLength);
                const downloadSpeed = toByteCount(a.downloadSpeed);
                const terminalUpdate: Aria2LiveFields =
                  a.status === "complete"
                    ? {
                        status: "COMPLETED",
                        progress: t("apiDownloads.completed", locale),
                        completedBytes,
                        totalBytes,
                        downloadSpeed,
                      }
                    : a.status === "error" || a.status === "removed"
                    ? {
                        status: "FAILED",
                        progress,
                        errorMessage: t("apiDownloads.aria2ErrorWithStatus", locale).replace("{status}", a.status),
                        completedBytes,
                        totalBytes,
                        downloadSpeed,
                      }
                    : {
                        progress,
                        completedBytes,
                        totalBytes,
                        downloadSpeed,
                      };
                aria2FieldByTaskId.set(taskId, terminalUpdate);
                return prisma.downloadTask.update({
                  where: { id: taskId },
                  // Progress-only patch; cast avoids Prisma enum/input narrowing on partial fields.
                  data: terminalUpdate as Parameters<
                    typeof prisma.downloadTask.update
                  >[0]["data"],
                });
              }),
            );
          }
          await Promise.all(updates);
        } catch (err) {
          logError("[DownloadAPI] aria2 refresh skipped:", err);
        }
      }

      const safe = visibleTasks.map((t) => ({
        ...t,
        ...(aria2FieldByTaskId.get(t.id) ?? {}),
        pid: t.pid ?? null,
        aria2Gid: t.aria2Gid ?? null,
        category: t.category ?? null,
        maxSpeedKb: t.maxSpeedKb ?? null,
        totalBytes: t.totalBytes ?? null,
        completedBytes: t.completedBytes ?? null,
        downloadSpeed: t.downloadSpeed ?? null,
        fileSize: t.fileSize ?? null,
        isBatch: t.isBatch ?? false,
        batchUrls: t.batchUrls ?? null,
        downloadAccess: taskDownloadAccess({ ...t, locale }),
      }));

      let globalStat = null;
      if (aria2Available) {
        try {
          globalStat = await getGlobalStat();
        } catch (err) {
          logError("[DownloadAPI] globalStat fetch failed:", err);
        }
      }

      return NextResponse.json({ tasks: safe, globalStat });
    },
  );
}
