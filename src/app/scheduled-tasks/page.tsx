import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listScheduledTasks, describeCron } from "@/lib/scheduled-task/service";
import { listServerProfiles } from "@/lib/server/service";
import { listTemplates } from "@/lib/command-template/service";

import { ScheduledTaskListClient } from "./scheduled-task-list-client";
import { PageShell, PageHeader } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

export default async function ScheduledTasksPage() {
	const session = await requireSession();
	const locale = await getServerLocale();
	const tr = (key: string, vars?: Record<string, string | number>) => t(key, locale, vars);
	const canCreate = sessionHasPermission(session, "command:create");
	const canManage = sessionHasPermission(session, "command:execute");
	const canApprove = sessionHasPermission(session, "command:approve");

	const [tasks, servers, templates] = await Promise.all([
		listScheduledTasks(200, session),
		listServerProfiles(session),
		listTemplates(200, session),
	]);

	const serialized = tasks.map((t) => ({
		id: t.id,
		name: t.name,
		cronExpression: t.cronExpression,
		cronDescription: t.scheduleType === "ONCE" ? tr("scheduledTasks.schedule.once") : describeCron(t.cronExpression),
		scheduleType: t.scheduleType,
		runAt: t.runAt?.toISOString() ?? null,
		command: t.command,
		reason: t.reason,
		plan: t.plan,
		verificationCommand: t.verificationCommand,
		rollbackCommand: t.rollbackCommand,
		approvalRequired: t.approvalRequired,
		source: t.source,
		templateId: t.templateId,
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
	const templateOptions = templates.map((template) => ({
		id: template.id,
		name: template.name,
		description: template.description,
		command: template.command,
		rollbackCommand: template.rollbackCommand,
		variables: template.variables,
		tags: template.tags,
	}));

	return (
		<PageShell maxW="max-w-7xl">
			<PageHeader
				eyebrow={t("scheduledTasksPage.eyebrow", locale)}
				title={tr("scheduledTasksPage.header.title")}
				description={tr("scheduledTasksPage.header.description")}
			/>
			<ScheduledTaskListClient tasks={serialized} servers={serverOptions} templates={templateOptions} canCreate={canCreate} canManage={canManage} canApprove={canApprove} />
		</PageShell>
	);
}
