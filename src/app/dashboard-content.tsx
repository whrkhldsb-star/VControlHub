import { PageShell } from "@/components/page-shell";
import { requireSession } from "@/lib/auth/require-session";
import { listCommandRequests } from "@/lib/command/service";
import { formatDateTime } from "@/lib/datetime/format";
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

export async function DashboardContent({ sessionPath }: { sessionPath: "/" | "/dashboard" }) {
	const session = await requireSession(sessionPath);
	const [servers, storage, requests, recentAuditLogs, downloadStats, unreadNotifications, activeScheduledTasks, dragReorderEnabledRaw] = await Promise.all([
		listServerProfiles(session),
		getStorageOverview(),
		listCommandRequests(session),
		prisma.auditLog.findMany({
			take: 5,
			orderBy: { createdAt: "desc" },
			include: { actor: { select: { username: true, displayName: true } } },
		}),
		prisma.downloadTask.groupBy({ by: ["status"], _count: true }),
		getUnreadCount(session.userId),
		prisma.scheduledTask.count({ where: { status: "ACTIVE" } }),
		getSetting("dashboard.layout.dragReorderEnabled"),
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
				<div data-dashboard-widget="analytics"><DashboardAnalyticsPanel /></div>
				<DashboardRecentActivity recentRequests={recentRequests} recentAuditLogs={recentAudit} />
			</DashboardPreferenceClient>
		</PageShell>
	);
}

