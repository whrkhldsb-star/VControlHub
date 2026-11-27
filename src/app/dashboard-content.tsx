import { PageShell } from "@/components/page-shell";
import { dashboardCommands, failedTaskSummary, openIncidentSummary } from "@/lib/dashboard/attention-queries";
import { listActiveAnnouncements } from "@/lib/announcement/service";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { activeCustomerTeamWhere, isGlobalTeamManager, serverTeamWhere, teamWhere } from "@/lib/auth/team-scope";
import { canReadCommandBody } from "@/lib/command/visibility";
import { formatDateTime, formatShortTime } from "@/lib/datetime/format";
import { buildAttentionChecks } from "@/lib/dashboard/attention";
import { buildSetupChecklist, countPendingSetupItems, filterSetupChecklist } from "@/lib/dashboard/setup-checklist";
import { loadSidebarDeclaredPermissions } from "@/lib/auth/declared-permissions";
import { mainNavItems, systemNavItems } from "@/components/nav-items";
import { prisma } from "@/lib/db";
import { getOperationTaskTitle } from "@/lib/i18n/domain-labels";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { logError } from "@/lib/logging";
import { getUnreadCount } from "@/lib/notification/service";
import { downloadSummary } from "@/lib/dashboard/download-summary";
import { listServerProfiles } from "@/lib/server/service";
import { getSetting } from "@/lib/settings/service";
import { getStorageOverview } from "@/lib/storage/service";

import { incidentTitle } from "./alert-rules/incident-labels";
import { DashboardAnalyticsPanel } from "./dashboard-analytics-panel";
import { DashboardAttention } from "./dashboard-attention";
import { DashboardFeatureMap } from "./dashboard-feature-map";
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

const featureMapHrefs = [...mainNavItems, ...systemNavItems].map((item) => item.href);

export async function DashboardContent({ sessionPath }: { sessionPath: "/" | "/dashboard" }) {
	const session = await requireSession(sessionPath);
	const teamScope = teamWhere(session);
	const activeTeamScope = activeCustomerTeamWhere(session);
	const serverScope = serverTeamWhere(session);
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
	const checkedAt = new Date();
	const [
		servers,
		storage,
		commands,
		recentAuditLogs,
		downloads,
		unreadNotifications,
		activeScheduledTasks,
		dragReorderEnabledRaw,
		enabledAlertRuleCount,
		smtpEnabledRaw,
		telegramEnabledRaw,
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
		canReadCommands ? dashboardCommands(session) : { requests: [], pendingApprovals: 0, review: null },
		canReadAudit ? prisma.auditLog.findMany({
			where: teamScope,
			take: 5,
			orderBy: { createdAt: "desc" },
			select: {
				id: true,
				action: true,
				severity: true,
				actorType: true,
				createdAt: true,
				actor: { select: { username: true, displayName: true } },
			},
		}) : Promise.resolve([]),
		canReadStorage
			? downloadSummary(session).then((result) => result.totals).catch((error) => {
				logError("Dashboard download ACL summary unavailable", error);
				return null;
			})
			: Promise.resolve(null),
		getUnreadCount(session.userId),
		canReadCommands
			? prisma.scheduledTask.count({ where: { status: "ACTIVE", ...activeTeamScope } })
			: Promise.resolve(0),
		getSetting("dashboard.layout.dragReorderEnabled"),
		canManageNotifications
			? prisma.alertRule.count({ where: { enabled: true, ...activeTeamScope } }).catch(() => null)
			: Promise.resolve(null),
		canManageSettings ? getSetting("smtp.enabled") : Promise.resolve(null),
		canManageSettings ? getSetting("telegram.enabled") : Promise.resolve(null),
		canReadBackups ? prisma.backupSchedule.count({ where: isGlobalTeamManager(session) ? {} : activeTeamScope }).catch(() => 0) : Promise.resolve(0),
		canReadBackups ? prisma.vpsBackupSchedule
			.count({
				where: {
					server: serverScope,
				},
			})
			.catch(() => 0) : Promise.resolve(0),
		canReadCosts ? prisma.server
			.count({
				where: {
					...serverScope,
					costMonthlyAmount: { gt: 0 },
				},
			})
			.catch(() => 0) : Promise.resolve(0),
		listActiveAnnouncements().catch(() => []),
		// A check that cannot be made is left out of the block rather than reported as clear. OPEN incidents are the
		// ones nobody has acknowledged yet; the list comes worst level first.
		canManageNotifications
			? openIncidentSummary(session).catch(() => null)
			: Promise.resolve(null),
		canReadTasks
			? failedTaskSummary(session, checkedAt)
				.catch(() => null)
			: Promise.resolve(null),
	]);

	const enabledServers = servers.filter((server) => server.enabled);
	const { requests } = commands;
	const queue = {
		pendingApprovals: canApproveCommands ? commands.review?.count ?? 0 : commands.pendingApprovals,
		downloads: downloads && {
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
	const recentRequests = requests.map((request) => ({
		id: request.id,
		title: request.title,
		command: canReadCommandBody(session.userId, request.requesterId, canApproveCommands) ? request.command : null,
		status: request.status,
		isAssistantInitiated: request.isAssistantInitiated,
		requester: request.requester,
		targetCount: request.targetCount,
	}));
	// Each row links to the page that completes it; an account without that
	// permission would only reach "no permission", so it never sees the row.
	const setupItems = filterSetupChecklist(
		buildSetupChecklist({
			serverCount: servers.length,
			enabledAlertRuleCount: enabledAlertRuleCount ?? 0,
			smtpEnabled: smtpEnabledRaw === "true",
			telegramEnabled: telegramEnabledRaw === "true",
			backupScheduleCount: projectBackupScheduleCount + vpsBackupScheduleCount,
			serversWithMonthlyCost,
		}),
		(permission) => sessionHasPermission(session, permission),
	);
	// Named the way their own pages name them, in the viewer's language: incidents store English text for the
	// outbound channels, and a backup task's stored title reads "DATABASE backup".
	const translate = (key: string, vars?: Record<string, string | number>) => t(key, locale, vars);
	const attentionChecks = buildAttentionChecks({
		openIncidents: openIncidents && {
			count: openIncidents.count, latest: openIncidents.latest ? incidentTitle(openIncidents.latest, translate) : null,
		},
		failedTasks: failedTasks && {
			count: failedTasks.count, latest: failedTasks.latest ? getOperationTaskTitle(translate, failedTasks.latest) : null,
		},
		// Waiting for this account: its own requests go to another reviewer (unless it manages the team).
		pendingApprovals: canApproveCommands
			? commands.review
			: null,
		now: checkedAt,
	});
	// First run: no server yet. The checklist then comes first, and with no alert rule either the checks above
	// have nothing to report, so they say "not set up yet" rather than "all clear".
	const firstRun = canReadServers && servers.length === 0;
	const notSetUp = firstRun && enabledAlertRuleCount === 0;
	// The feature map lists the pages the sidebar would show this account.
	const declaredPermissions = loadSidebarDeclaredPermissions(featureMapHrefs);
	const visibleHrefs = featureMapHrefs.filter((href) => {
		const required = declaredPermissions[href] ?? [];
		return required.length === 0 || required.some((permission) => sessionHasPermission(session, permission));
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
			<DashboardLocalizedHeader
				canReadServers={canReadServers}
				canReadTasks={canReadTasks}
				setupPending={countPendingSetupItems(setupItems)}
			/>
			{firstRun ? <DashboardSetupChecklist items={setupItems} /> : null}
			<DashboardAttention checks={attentionChecks} checkedAt={formatShortTime(checkedAt, locale)} notSetUp={notSetUp} />
			<DashboardAnnouncements items={dashboardAnnouncements} total={announcements.length} />
			{firstRun ? null : <DashboardSetupChecklist items={setupItems} />}
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
				<DashboardQuickLinks {...queue} visible={{ servers: canReadServers, storage: canReadStorage, commands: canReadCommands }} />
				<div data-dashboard-widget="analytics">
					<DashboardAnalyticsPanel />
				</div>
				<DashboardRecentActivity recentRequests={recentRequests} recentAuditLogs={recentAudit} />
			</DashboardPreferenceClient>
			<DashboardFeatureMap visibleHrefs={visibleHrefs} />
		</PageShell>
	);
}
