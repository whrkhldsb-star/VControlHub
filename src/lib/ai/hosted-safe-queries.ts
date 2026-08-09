/**
 * Serverless hosted-AI query handlers (no SSH / no bound serverId).
 *
 * Pure move out of hosted-service.ts `executeSafeAction`:
 *   search_knowledge / list_servers / list_backups / query_traffic / manage_cron
 * Behaviour is byte-identical; hosted-service delegates here first and falls
 * through to the SSH execution path when this module returns null.
 */

import type { SessionPayload } from "@/lib/auth/session";
import { serverTeamWhere, teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { t, type Locale } from "@/lib/i18n/service-translations";

export type SafeActionResult = { success: boolean; data: unknown; error?: string };

type TeamScope = Pick<SessionPayload, "userId" | "roles" | "currentTeamId"> | null;

function periodToSince(periodRaw: unknown): { since: Date; period: string } {
  const period = typeof periodRaw === "string" ? periodRaw.trim().toLowerCase() : "today";
  const now = Date.now();
  if (period === "7d" || period === "7days" || period === "week") {
    return { since: new Date(now - 7 * 24 * 3600_000), period: "7d" };
  }
  if (period === "30d" || period === "30days" || period === "month") {
    return { since: new Date(now - 30 * 24 * 3600_000), period: "30d" };
  }
  // today (default): last 24h of samples
  return { since: new Date(now - 24 * 3600_000), period: "today" };
}

/**
 * Handle a serverless query action. Returns null when the actionType is not
 * one of the serverless queries (caller falls through to SSH execution).
 */
export async function executeServerlessQuery(
  action: { actionType: string; params: Record<string, unknown> },
  scope: TeamScope,
  locale: Locale = "zh",
): Promise<SafeActionResult | null> {
  if (action.actionType === "search_knowledge") {
    const query = typeof action.params.query === "string" ? action.params.query : "";
    const knowledgeBaseId =
      typeof action.params.knowledgeBaseId === "string" ? action.params.knowledgeBaseId : undefined;
    const limitRaw = action.params.limit;
    const limit =
      typeof limitRaw === "number"
        ? limitRaw
        : typeof limitRaw === "string"
          ? Number(limitRaw)
          : 5;
    const { searchKnowledge } = await import("./knowledge");
    const hits = await searchKnowledge({
      query,
      knowledgeBaseId,
      limit: Number.isFinite(limit) ? limit : 5,
      // Always pass a session when available so teamWhere applies; never force currentTeamId=null.
      session: scope ?? undefined,
    });
    return {
      success: true,
      data: {
        hits: hits.map((h) => ({
          knowledgeBase: h.knowledgeBaseName,
          document: h.documentTitle,
          chunkIndex: h.chunkIndex,
          score: h.score,
          excerpt: h.content.slice(0, 1200),
        })),
        count: hits.length,
      },
    };
  }

  if (action.actionType === "list_servers") {
    const servers = await prisma.server.findMany({
      where: scope ? serverTeamWhere(scope) : { teamId: null },
      orderBy: [{ enabled: "desc" }, { name: "asc" }],
      select: { id: true, name: true, host: true, port: true, username: true, enabled: true },
      take: 500, // P2: server 总数有限
    });
    return { success: true, data: { servers } };
  }

  if (action.actionType === "list_backups") {
    const typeFilter =
      typeof action.params.type === "string" && action.params.type.trim()
        ? action.params.type.trim().toUpperCase()
        : undefined;
    const statusFilter =
      typeof action.params.status === "string" && action.params.status.trim()
        ? action.params.status.trim().toUpperCase()
        : undefined;
    const records = await prisma.backupRecord.findMany({
      where: {
        ...(scope ? teamWhere(scope) : {}),
        ...(typeFilter ? { type: typeFilter } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        type: true,
        status: true,
        note: true,
        fileSize: true,
        createdAt: true,
        completedAt: true,
        errorMessage: true,
      },
    });
    return {
      success: true,
      data: {
        backups: records.map((r) => ({
          id: r.id,
          type: r.type,
          status: r.status,
          note: r.note,
          fileSize: r.fileSize ?? null,
          createdAt: r.createdAt.toISOString(),
          completedAt: r.completedAt?.toISOString() ?? null,
          errorMessage: r.errorMessage,
        })),
        count: records.length,
      },
    };
  }

  if (action.actionType === "query_traffic") {
    const { since, period } = periodToSince(action.params.period);
    const visibleServers = scope
      ? await prisma.server.findMany({
          where: serverTeamWhere(scope),
          select: { id: true },
          take: 5000,
        })
      : [];
    const visibleServerIds = visibleServers.map((s) => s.id);
    const rows = await prisma.trafficSnapshot.findMany({
      where: {
        sampledAt: { gte: since },
        ...(scope
          ? {
              OR: [
                { serverId: null },
                ...(visibleServerIds.length > 0 ? [{ serverId: { in: visibleServerIds } }] : []),
              ],
            }
          : {}),
      },
      orderBy: { sampledAt: "desc" },
      take: 2000,
      select: {
        source: true,
        serverId: true,
        iface: true,
        rxRateBps: true,
        txRateBps: true,
        sampledAt: true,
      },
    });
    let totalRxRate = 0;
    let totalTxRate = 0;
    for (const row of rows) {
      totalRxRate += row.rxRateBps ?? 0;
      totalTxRate += row.txRateBps ?? 0;
    }
    const sampleCount = rows.length;
    const avgRx = sampleCount ? totalRxRate / sampleCount : 0;
    const avgTx = sampleCount ? totalTxRate / sampleCount : 0;
    const latest = rows[0] ?? null;
    return {
      success: true,
      data: {
        period,
        sampleCount,
        averageRxBps: Math.round(avgRx),
        averageTxBps: Math.round(avgTx),
        latest: latest
          ? {
              source: latest.source,
              serverId: latest.serverId,
              iface: latest.iface,
              rxRateBps: latest.rxRateBps,
              txRateBps: latest.txRateBps,
              sampledAt: latest.sampledAt.toISOString(),
            }
          : null,
        note: sampleCount === 0
          ? t("backend.ai.noTrafficSamplesInPeriod", locale)
          : undefined,
      },
    };
  }

  if (action.actionType === "manage_cron") {
    const cronAction =
      typeof action.params.action === "string" ? action.params.action.trim().toLowerCase() : "";
    const taskId = typeof action.params.taskId === "string" ? action.params.taskId.trim() : "";

    if (cronAction === "list" || !cronAction) {
      const { listScheduledTasks } = await import("@/lib/scheduled-task/service");
      const tasks = await listScheduledTasks(50, scope ?? null);
      return {
        success: true,
        data: {
          tasks: tasks.map((t) => ({
            id: t.id,
            name: t.name,
            cronExpression: t.cronExpression,
            status: t.status,
            nextRunAt: t.nextRunAt?.toISOString?.() ?? t.nextRunAt ?? null,
            lastRunAt: t.lastRunAt?.toISOString?.() ?? t.lastRunAt ?? null,
            lastResult: typeof t.lastResult === "string" ? t.lastResult.slice(0, 200) : t.lastResult,
          })),
          count: tasks.length,
        },
      };
    }

    if (cronAction === "pause" || cronAction === "resume") {
      if (!taskId) {
        return { success: false, data: null, error: t("backend.ai.cron.taskIdRequired", locale) };
      }
      // Pause/resume mutates schedule state — require task:read is already checked;
      // still scope lookup by team and only flip ACTIVE↔PAUSED via toggleScheduledTask
      // (which recomputes nextRunAt on resume).
      const { getScheduledTask, toggleScheduledTask } = await import("@/lib/scheduled-task/service");
      try {
        const task = await getScheduledTask(taskId, scope ?? null);
        if (cronAction === "pause") {
          if (task.status === "PAUSED") {
            return { success: true, data: { id: task.id, status: task.status, message: t("backend.ai.cron.alreadyPaused", locale) } };
          }
          if (task.status !== "ACTIVE") {
            return {
              success: false,
              data: null,
              error: t("backend.ai.cron.cannotPauseStatus", locale, {
                status: task.status,
              }),
            };
          }
          const updated = await toggleScheduledTask(taskId, scope ?? null);
          return { success: true, data: { id: updated.id, status: updated.status } };
        }
        // resume
        if (task.status === "ACTIVE") {
          return { success: true, data: { id: task.id, status: task.status, message: t("backend.ai.cron.alreadyActive", locale) } };
        }
        if (task.status !== "PAUSED") {
          return {
            success: false,
            data: null,
            error: t("backend.ai.cron.cannotResumeStatus", locale, {
              status: task.status,
            }),
          };
        }
        const updated = await toggleScheduledTask(taskId, scope ?? null);
        return { success: true, data: { id: updated.id, status: updated.status } };
      } catch (err) {
        return {
          success: false,
          data: null,
          error: err instanceof Error ? err.message : t( "backend.ai.cron.operationFailed", locale),
        };
      }
    }

    return {
      success: false,
      data: null,
      error: t( "backend.ai.cron.unsupportedAction", locale),
    };
  }

  return null;
}
