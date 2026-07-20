import { PageShell } from "@/components/page-shell";
import { requireSession } from "@/lib/auth/require-session";
import { teamWhere } from "@/lib/auth/team-scope";
import { listCommandRequests } from "@/lib/command/service";
import { formatDateTime } from "@/lib/datetime/format";
import { buildSetupChecklist } from "@/lib/dashboard/setup-checklist";
import { prisma } from "@/lib/db";
import { getServerLocale } from "@/lib/i18n/translations";
import { getUnreadCount } from "@/lib/notification/service";
import { listServerProfiles } from "@/lib/server/service";
import { getSetting } from "@/lib/settings/service";
import { getStorageOverview } from "@/lib/storage/service";

import { DashboardAnalyticsPanel } from "./dashboard-analytics-panel";
import {
	DashboardLocalizedHeader,
	DashboardQuickLinks,
	DashboardRecentActivity,
	DashboardServerHero,
	DashboardStatsSection,
} from "./dashboard-localized-sections";
import { DashboardPreferenceClient } from "./dashboard-preference-client";
import { DashboardSetupChecklist } from "./dashboard-setup-checklist";

export async function DashboardContent({ sessionPath }: { sessionPath: "/" | "/dashboard" }) {
	const session = await requireSession(sessionPath);
	const teamScope = teamWhere(session);
	const [
		servers,
		storage,
		requests,
		recentAuditLogs,
		downloadStats,
		unreadNotifications,
		activeScheduledTasks,
		dragReorderEnabledRaw,
		enabledAlertRuleCount,
		smtpEnabledRaw,
		projectBackupScheduleCount,
		vpsBackupScheduleCount,
		serversWithMonthlyCost,
	] = await Promise.all([
		listServerProfiles(session),
		getStorageOverview(session),
		listCommandRequests(session),
		prisma.auditLog.findMany({
			where: teamScope,
			take: 5,
			orderBy: { createdAt: "desc" },
			include: { actor: { select: { username: true, displayName: true } } },
		}),
		prisma.downloadTask.groupBy({ by: ["status"], where: teamScope, _count: true }),
		getUnreadCount(session.userId),
		prisma.scheduledTask.count({ where: { status: "ACTIVE", ...teamScope } }),
		getSetting("dashboard.layout.dragReorderEnabled"),
		prisma.alertRule.count({ where: { enabled: true, ...teamScope } }).catch(() => 0),
		getSetting("smtp.enabled"),
		prisma.backupSchedule.count({ where: teamScope }).catch(() => 0),
		prisma.vpsBackupSchedule.count().catch(() => 0),
		prisma.server
			.count({
				where: {
					...teamScope,
					costMonthlyAmount: { gt: 0 },
				},
			})
			.catch(() => 0),
	]);

	const enabledServers = servers.filter((server) => server.enabled);
	const downloads = Object.fromEntries(downloadStats.map((item) => [item.status, item._count]));
	const pendingApprovals = requests.filter((request) => request.status === "PENDING_APPROVAL").length;
	const queue = {
		pendingApprovals,
		downloads: {
			running: downloads.RUNNING ?? 0,
			completed: downloads.COMPLETED ?? 0,
			failed: downloads.FAILED ?? 0,
		},
		unreadNotifications,
		activeScheduledTasks,
	};
	const locale = await getServerLocale();
	const recentAudit = recentAuditLogs.map((log) => ({
		...log,
		createdAt: log.createdAt.toISOString(),
		formattedCreatedAt: formatDateTime(log.createdAt, locale),
	}));
	const recentRequests = requests.slice(0, 5).map((request) => ({
		id: request.id,
		title: request.title,
		command: request.command,
		status: request.status,
		approvalStateLabel: request.approvalStateLabel,
		isAssistantInitiated: request.isAssistantInitiated,
		requester: request.requester,
		targetCount: request.targets.length,
	}));
	const setupItems = buildSetupChecklist({
		serverCount: servers.length,
		enabledAlertRuleCount,
		smtpEnabled: smtpEnabledRaw === "true",
		backupScheduleCount: projectBackupScheduleCount + vpsBackupScheduleCount,
		serversWithMonthlyCost,
	});

	return (
		<PageShell maxW="max-w-7xl">
			<DashboardLocalizedHeader username={session.username} />
			<DashboardSetupChecklist items={setupItems} />
			<DashboardStatsSection
				storage={{
					serverTotal: servers.length,
					serverEnabled: enabledServers.length,
					totalNodes: storage.stats.totalNodes,
					totalEntries: storage.stats.totalEntries,
				}}
				queue={queue}
			/>
			<DashboardPreferenceClient dragReorderEnabled={dragReorderEnabledRaw !== "false"}>
				<DashboardServerHero
					summary={{
						total: servers.length,
						enabled: enabledServers.length,
						disabled: servers.length - enabledServers.length,
						sshKey: servers.filter((server) => server.sshKey).length,
						directGateway: servers.filter((server) => server.directGateway?.enabled).length,
					}}
				/>
				<DashboardQuickLinks {...queue} />
				<div data-dashboard-widget="analytics">
					<DashboardAnalyticsPanel />
				</div>
				<DashboardRecentActivity recentRequests={recentRequests} recentAuditLogs={recentAudit} />
			</DashboardPreferenceClient>
		</PageShell>
	);
}
