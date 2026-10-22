import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/logging";
import { ensureAria2Daemon, tellStatus, getGlobalStat } from "@/lib/aria2/service";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { buildProgressText } from "@/lib/downloads/helpers";
import { withApiRoute } from "@/lib/http/api-guard";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { teamWhere } from "@/lib/auth/team-scope";
import { canAccessDownloadTask, taskDownloadAccess } from "@/lib/downloads/route-helpers";

const DOWNLOAD_PAGE_SIZE = 100;

/* ── GET: List tasks with real-time aria2 progress ────────── */

export async function GET(request: Request) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: t("apiDownloads.fetchTasksFailed", locale) },
    async ({ session }) => {
      const { serverId, category, status, cursor } = parseSearchParams(
        request,
        z.object({
          serverId: z.string().trim().min(1).optional(),
          category: z.string().trim().min(1).optional(),
          status: z
            .enum(["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"])
            .optional(),
          cursor: z.string().trim().min(1).optional(),
        }),
      );

      // Team prefilter first (perf + defense if ownership/storage ACL misses team);
      // canAccessDownloadTask still applies creator/storage ACL on the reduced set.
      const where: Record<string, unknown> =
        category === "__uncategorized"
          ? {
              AND: [
                teamWhere(session),
                { OR: [{ category: null }, { category: "" }] },
              ],
            }
          : { ...teamWhere(session) };
      if (serverId) where.serverId = serverId;
      if (category && category !== "__uncategorized") where.category = category;
      if (status) where.status = status;

      const taskRows = await prisma.downloadTask.findMany({
        where,
        include: {
          server: { select: { id: true, name: true, host: true, storageNode: { select: { id: true, basePath: true, driver: true, host: true, port: true, directAccessMode: true, publicBaseUrl: true, directAccessExpiresSeconds: true } } } },
          creator: { select: { id: true, username: true, displayName: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: DOWNLOAD_PAGE_SIZE + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const hasMore = taskRows.length > DOWNLOAD_PAGE_SIZE;
      const tasks = taskRows.slice(0, DOWNLOAD_PAGE_SIZE);
      const nextCursor = hasMore ? (tasks.at(-1)?.id ?? null) : null;

      // Parallel ACL checks (still bounded by one page) — sequential awaits made
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
      // aria2 completion is only the first half of a relay workflow. The worker
      // must still copy and index the artifact on the target VPS, so GET must
      // never promote an aria2 relay task to business-level COMPLETED.
      type Aria2LiveFields = {
        status?: "FAILED";
        progress?: string;
        errorMessage?: string;
        completedBytes?: string | null;
        totalBytes?: string | null;
        downloadSpeed?: string | null;
      };
      const aria2FieldByTaskId = new Map<string, Aria2LiveFields>();
      // The byte columns are strings (counts can pass 2^53). Numbers were
      // refused by Prisma on every poll, so the live state never reached the
      // database while the response showed it as if it had.
      const toByteCount = (value: unknown): string | null => {
        if (value == null || value === "") return null;
        const n = typeof value === "number" ? value : Number(value);
        return Number.isFinite(n) && n >= 0 ? String(Math.trunc(n)) : null;
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
                        progress: t("apiDownloads.transferPending", locale),
                        completedBytes,
                        totalBytes,
                        downloadSpeed,
                      }
                    : a.status === "error" || a.status === "removed"
                    ? {
                        status: "FAILED",
                        progress,
                        errorMessage: t("apiDownloads.aria2ErrorWithStatus", locale, { status: a.status }),
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
                // Shown only once stored: the list must not report a state the
                // database does not hold.
                return prisma.downloadTask
                  .update({ where: { id: taskId }, data: terminalUpdate })
                  .then(() => { aria2FieldByTaskId.set(taskId, terminalUpdate); });
              }),
            );
          }
          for (const outcome of await Promise.allSettled(updates)) {
            if (outcome.status === "rejected") logError("[DownloadAPI] aria2 status not stored:", outcome.reason);
          }
        } catch (err) {
          logError("[DownloadAPI] aria2 refresh skipped:", err);
        }
      }

      const safe = visibleTasks.map((task) => {
        const merged = { ...task, ...(aria2FieldByTaskId.get(task.id) ?? {}) };
        return {
          ...merged,
          pid: merged.pid ?? null,
          aria2Gid: merged.aria2Gid ?? null,
          category: merged.category ?? null,
          maxSpeedKb: merged.maxSpeedKb ?? null,
          totalBytes: merged.totalBytes ?? null,
          completedBytes: merged.completedBytes ?? null,
          downloadSpeed: merged.downloadSpeed ?? null,
          fileSize: merged.fileSize ?? null,
          isBatch: merged.isBatch ?? false,
          batchUrls: merged.batchUrls ?? null,
          downloadAccess: taskDownloadAccess({ ...merged, locale }),
        };
      });

      let globalStat = null;
      if (aria2Available) {
        try {
          globalStat = await getGlobalStat();
        } catch (err) {
          logError("[DownloadAPI] globalStat fetch failed:", err);
        }
      }

      return NextResponse.json({ tasks: safe, globalStat, nextCursor });
    },
  );
}
