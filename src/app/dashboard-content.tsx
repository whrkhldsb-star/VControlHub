import { PageShell } from "@/components/page-shell";
import { listAlertIncidents } from "@/lib/alert/incidents";
import { listActiveAnnouncements } from "@/lib/announcement/service";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { teamWhere } from "@/lib/auth/team-scope";
import { mayReviewCommandRequest } from "@/lib/command/review-scope";
import { listCommandRequests } from "@/lib/command/service";
import { formatDateTime, formatShortTime } from "@/lib/datetime/format";
import { buildAttentionChecks } from "@/lib/dashboard/attention";
import { buildSetupChecklist, filterSetupChecklist } from "@/lib/dashboard/setup-checklist";
import { prisma } from "@/lib/db";
import { getOperationTaskTitle } from "@/lib/i18n/domain-labels";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { getUnreadCount } from "@/lib/notification/service";
import { listOperationTaskResult } from "@/lib/operation-task/service";
import { listServerProfiles } from "@/lib/server/service";
import { getSetting } from "@/lib/settings/service";
import { getStorageOverview } from "@/lib/storage/service";

import { incidentTitle } from "./alert-rules/incident-labels";
import { DashboardAnalyticsPanel } from "./dashboard-analytics-panel";
import { DashboardAttention } from "./dashboard-attention";
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
	// The checks at the top follow the pages that deal with what they find.
	const canReadTasks = sessionHasPermission(session, "task:read");
	const canApproveCommands = canReadCommands && sessionHasPermission(session, "command:approve");
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
		openIncidents,
		failedTasks,
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
		// A check that cannot be made is left out of the block rather than reported as clear. OPEN incidents are the
		// ones nobody has acknowledged yet; the list comes worst level first.
		canManageNotifications
			? listAlertIncidents({ status: "OPEN", take: 500, session }).catch(() => null)
			: Promise.resolve(null),
		canReadTasks
			? listOperationTaskResult({ status: "failed", limit: 50 }, session)
				.then((result) => result.tasks)
				.catch(() => null)
			: Promise.resolve(null),
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
	const checkedAt = new Date();
	// Named the way their own pages name them, in the viewer's language: incidents store English text for the
	// outbound channels, and a backup task's stored title reads "DATABASE backup".
	const translate = (key: string, vars?: Record<string, string | number>) => t(key, locale, vars);
	const attentionChecks = buildAttentionChecks({
		openIncidents: openIncidents
			? [...openIncidents]
				.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
				.map((incident) => ({ title: incidentTitle(incident, translate) }))
			: null,
		failedTasks: failedTasks
			? failedTasks.map((task) => ({ title: getOperationTaskTitle(translate, task), updatedAt: task.updatedAt }))
			: null,
		// Waiting for this account: its own requests go to another reviewer (unless it manages the team).
		pendingApprovals: canApproveCommands
			? requests.filter((request) => request.status === "PENDING_APPROVAL" && mayReviewCommandRequest(session, request.requester.id))
			: null,
		now: checkedAt,
	});
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
			<DashboardLocalizedHeader />
			<DashboardAttention checks={attentionChecks} checkedAt={formatShortTime(checkedAt, locale)} />
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
