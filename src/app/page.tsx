/**
 * Compatibility wrapper for the legacy `/` route.
 *
 * The actual dashboard lives at `src/app/dashboard/page.tsx` (TR-052: dedicated
 * route so the user can bookmark the dashboard directly). This thin server
 * component re-renders the same dashboard data under `/` so existing deep links
 * and crawlers that still hit `/` keep working.
 */
import { requireSession } from "@/lib/auth/require-session";
import { listServerProfiles } from "@/lib/server/service";
import { getStorageOverview } from "@/lib/storage/service";
import { listCommandRequests } from "@/lib/command/service";
import { getUnreadCount } from "@/lib/notification/service";
import { prisma } from "@/lib/db";
import { PageShell } from "@/components/page-shell";
import { getServerLocale } from "@/lib/i18n/translations";
import { formatDateTime } from "@/lib/datetime/format";
import { DashboardAnalyticsPanel } from "./dashboard-analytics-panel";
import { DashboardPreferenceClient } from "./dashboard-preference-client";
import {
  DashboardLocalizedHeader,
  DashboardQuickLinks,
  DashboardRecentActivity,
  DashboardServerHero,
  DashboardStatsSection,
} from "./dashboard-localized-sections";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await requireSession("/");
  const [servers, storage, requests, recentAuditLogs, downloadStats, unreadNotif, activeScheduled] = await Promise.all([
    listServerProfiles(),
    getStorageOverview(),
    listCommandRequests(),
    prisma.auditLog.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { actor: { select: { username: true, displayName: true } } },
    }),
    prisma.downloadTask.groupBy({ by: ["status"], _count: true }),
    getUnreadCount(session.userId),
    prisma.scheduledTask.count({ where: { status: "ACTIVE" } }),
  ]);

  const pendingCount = requests.filter((r) => r.status === "PENDING_APPROVAL").length;
  const recentRequests = requests.slice(0, 5);
  const enabledServers = servers.filter((s) => s.enabled);
  const disabledServers = servers.filter((s) => !s.enabled);
  const sshKeyServers = servers.filter((s) => s.sshKey);
  const directGatewayCount = servers.filter((s) => s.directGateway?.enabled).length;

  const dlRunning = downloadStats.find((d) => d.status === "RUNNING")?._count ?? 0;
  const dlCompleted = downloadStats.find((d) => d.status === "COMPLETED")?._count ?? 0;
  const dlFailed = downloadStats.find((d) => d.status === "FAILED")?._count ?? 0;

  const locale = await getServerLocale();
  const formattedAuditLogs = recentAuditLogs.map((log) => ({
    id: log.id,
    action: log.action,
    severity: log.severity,
    actorType: log.actorType,
    actor: log.actor,
    createdAt: log.createdAt.toISOString(),
    formattedCreatedAt: formatDateTime(log.createdAt, locale),
  }));

  const formattedRecentRequests = recentRequests.map((request) => ({
    id: request.id,
    title: request.title,
    command: request.command,
    status: request.status,
    approvalStateLabel: request.approvalStateLabel,
    isAssistantInitiated: request.isAssistantInitiated,
    requester: {
      username: request.requester.username,
      displayName: request.requester.displayName,
    },
    targetCount: request.targets.length,
  }));

  return (
    <PageShell maxW="max-w-7xl">
      <DashboardLocalizedHeader username={session.username} />
      <DashboardStatsSection
        storage={{
          serverTotal: servers.length,
          serverEnabled: enabledServers.length,
          totalNodes: storage.stats.totalNodes,
          totalEntries: storage.stats.totalEntries,
        }}
        queue={{
          pendingApprovals: pendingCount,
          downloads: { running: dlRunning, completed: dlCompleted, failed: dlFailed },
          unreadNotifications: unreadNotif,
          activeScheduledTasks: activeScheduled,
        }}
      />
      <DashboardPreferenceClient>
        <DashboardServerHero
          summary={{
            total: servers.length,
            enabled: enabledServers.length,
            disabled: disabledServers.length,
            sshKey: sshKeyServers.length,
            directGateway: directGatewayCount,
          }}
        />
        <DashboardQuickLinks
          pendingApprovals={pendingCount}
          downloads={{ running: dlRunning, completed: dlCompleted, failed: dlFailed }}
          unreadNotifications={unreadNotif}
          activeScheduledTasks={activeScheduled}
        />
        <div data-dashboard-widget="analytics">
          <DashboardAnalyticsPanel />
        </div>
        <DashboardRecentActivity recentRequests={formattedRecentRequests} recentAuditLogs={formattedAuditLogs} />
      </DashboardPreferenceClient>
    </PageShell>
  );
}
