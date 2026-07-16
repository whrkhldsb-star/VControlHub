import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listScheduledTasks, describeCron } from "@/lib/scheduled-task/service";
import { listServerProfiles } from "@/lib/server/service";

import { ScheduledTaskListClient } from "./scheduled-task-list-client";
import { PageShell, PageHeader } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

export default async function ScheduledTasksPage() {
	const session = await requireSession();
	const locale = await getServerLocale();
	const tr = (key: string) => t(key, locale);
	const canCreate = sessionHasPermission(session, "command:create");
	const canManage = sessionHasPermission(session, "command:execute");

	const [tasks, servers] = await Promise.all([
		listScheduledTasks(200, session),
		listServerProfiles(session),
	]);

	const serialized = tasks.map((t) => ({
		id: t.id,
		name: t.name,
		cronExpression: t.cronExpression,
		cronDescription: describeCron(t.cronExpression),
		command: t.command,
		reason: t.reason,
		status: t.status,
		serverIds: t.serverIds,
		lastRunAt: t.lastRunAt?.toISOString() ?? null,
		nextRunAt: t.nextRunAt?.toISOString() ?? null,
		lastResult: t.lastResult,
		runCount: t.runCount,
		createdAt: t.createdAt.toISOString(),
		creator: t.creator ? { username: t.creator.username, displayName: t.creator.displayName } : null,
	}));

	const serverOptions = servers.map((s) => ({ id: s.id, name: s.name, enabled: s.enabled }));

	return (
		<PageShell maxW="max-w-7xl">
			<PageHeader
				eyebrow={t("scheduledTasksPage.eyebrow", locale)}
				title={tr("scheduledTasksPage.header.title")}
				description={tr("scheduledTasksPage.header.description")}
			/>
			<ScheduledTaskListClient tasks={serialized} servers={serverOptions} canCreate={canCreate} canManage={canManage} />
		</PageShell>
	);
}
