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

      const where: Record<string, unknown> = {};
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

      const visibleTasks = [];
      for (const task of tasks) {
        if (await canAccessDownloadTask({ session, task, operation: "read" })) {
          visibleTasks.push(task);
        }
      }

      const activeGids = new Map<string, string>();
      for (const t of visibleTasks) {
        if (t.aria2Gid && ["PENDING", "RUNNING"].includes(t.status)) {
          activeGids.set(t.aria2Gid, t.id);
        }
      }
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
                const terminalUpdate =
                  a.status === "complete"
                    ? {
                        status: "COMPLETED" as const,
                        progress: t("apiDownloads.completed", locale),
                        completedBytes: a.completedLength,
                        totalBytes: a.totalLength,
                        downloadSpeed: a.downloadSpeed,
                      }
                    : a.status === "error" || a.status === "removed"
                    ? {
                        status: "FAILED" as const,
                        progress,
                        errorMessage: t("apiDownloads.aria2ErrorWithStatus", locale).replace("{status}", a.status),
                        completedBytes: a.completedLength,
                        totalBytes: a.totalLength,
                        downloadSpeed: a.downloadSpeed,
                      }
                    : {
                        progress,
                        completedBytes: a.completedLength,
                        totalBytes: a.totalLength,
                        downloadSpeed: a.downloadSpeed,
                      };
                return prisma.downloadTask.update({
                  where: { id: taskId },
                  data: terminalUpdate,
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
