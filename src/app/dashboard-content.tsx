import { PageShell } from "@/components/page-shell";
import { listActiveAnnouncements } from "@/lib/announcement/service";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { teamWhere } from "@/lib/auth/team-scope";
import { listCommandRequests } from "@/lib/command/service";
import { formatDateTime } from "@/lib/datetime/format";
import { buildSetupChecklist, filterSetupChecklist } from "@/lib/dashboard/setup-checklist";
import { prisma } from "@/lib/db";
import { getServerLocale } from "@/lib/i18n/translations";
import { getUnreadCount } from "@/lib/notification/service";
import { listServerProfiles } from "@/lib/server/service";
import { getSetting } from "@/lib/settings/service";
import { getStorageOverview } from "@/lib/storage/service";

import { DashboardAnalyticsPanel } from "./dashboard-analytics-panel";
import {
	DashboardAnnouncements,
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
	// The dashboard is available to every signed-in account, but its widgets
	// still carry the same data-class permissions as their target pages. Keep a
	// custom role without one of those permissions from receiving the underlying
	// command text, audit records, server inventory, or storage metadata in the
	// server component payload.
	const canReadServers = sessionHasPermission(session, "server:read");
	const canReadStorage = sessionHasPermission(session, "storage:read");
	const canReadCommands = sessionHasPermission(session, "command:read");
	const canReadAudit = sessionHasPermission(session, "audit:read");
	const canManageNotifications = sessionHasPermission(session, "notification:manage");
	const canReadBackups = sessionHasPermission(session, "backup:read");
	const canReadCosts = sessionHasPermission(session, "cost:read");
	const canManageSettings = sessionHasPermission(session, "user:manage");
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
		announcements,
	] = await Promise.all([
		canReadServers ? listServerProfiles(session) : Promise.resolve([]),
		canReadStorage
			? getStorageOverview(session, { includeEntries: false })
			: Promise.resolve({ stats: { totalNodes: 0, totalEntries: 0 } }),
		canReadCommands ? listCommandRequests(session) : Promise.resolve([]),
		canReadAudit ? prisma.auditLog.findMany({
			where: teamScope,
			take: 5,
			orderBy: { createdAt: "desc" },
			include: { actor: { select: { username: true, displayName: true } } },
		}) : Promise.resolve([]),
		canReadStorage
			? prisma.downloadTask.groupBy({ by: ["status"], where: teamScope, _count: true })
			: Promise.resolve([]),
		getUnreadCount(session.userId),
		canReadCommands
			? prisma.scheduledTask.count({ where: { status: "ACTIVE", ...teamScope } })
			: Promise.resolve(0),
		getSetting("dashboard.layout.dragReorderEnabled"),
		canManageNotifications
			? prisma.alertRule.count({ where: { enabled: true, ...teamScope } }).catch(() => 0)
			: Promise.resolve(0),
		canManageSettings ? getSetting("smtp.enabled") : Promise.resolve(null),
		canReadBackups ? prisma.backupSchedule.count({ where: teamScope }).catch(() => 0) : Promise.resolve(0),
		canReadBackups ? prisma.vpsBackupSchedule
			.count({
				where: {
					server: teamScope,
				},
			})
			.catch(() => 0) : Promise.resolve(0),
		canReadCosts ? prisma.server
			.count({
				where: {
					...teamScope,
					costMonthlyAmount: { gt: 0 },
				},
			})
			.catch(() => 0) : Promise.resolve(0),
		listActiveAnnouncements().catch(() => []),
	]);

	const enabledServers = servers.filter((server) => server.enabled);
	const downloads = Object.fromEntries(downloadStats.map((item) => [item.status, item._count]));
	const pendingApprovals = requests.filter((request) => request.status === "PENDING_APPROVAL").length;
	const queue = {
		pendingApprovals,
		downloads: {
			running: downloads.RUNNING ?? 0,
			pending: downloads.PENDING ?? 0,
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
		isAssistantInitiated: request.isAssistantInitiated,
		requester: request.requester,
		targetCount: request.targets.length,
	}));
	// Each row links to the page that completes it; an account without that
	// permission would only reach "no permission", so it never sees the row.
	const setupItems = filterSetupChecklist(
		buildSetupChecklist({
			serverCount: servers.length,
			enabledAlertRuleCount,
			smtpEnabled: smtpEnabledRaw === "true",
			backupScheduleCount: projectBackupScheduleCount + vpsBackupScheduleCount,
			serversWithMonthlyCost,
		}),
		(permission) => sessionHasPermission(session, permission),
	);
	const dashboardAnnouncements = announcements.slice(0, 3).map((item) => ({
		id: item.id,
		title: item.title,
		body: item.body,
		level: item.level,
		pinned: item.pinned,
		startsAt: item.startsAt.toISOString(),
		formattedStartsAt: formatDateTime(item.startsAt, locale),
	}));

	return (
		<PageShell>
			<DashboardLocalizedHeader username={session.username} />
			<DashboardAnnouncements items={dashboardAnnouncements} total={announcements.length} />
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
