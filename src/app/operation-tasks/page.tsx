import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listOperationTaskResult } from "@/lib/operation-task/service";
import { OperationTaskListClient } from "./operation-task-list-client";
import { PageShell, EmptyState, PageHeader } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const revalidate = 30;

export default async function OperationTasksPage() {
	const session = await requireSession("/operation-tasks");
	const locale = await getServerLocale();
	const tr = (key: string) => t(key, locale);
	if (!sessionHasPermission(session, "task:read")) {
		return <PageShell maxW="max-w-7xl"><EmptyState text={tr("operationTasksPage.noPermission")} variant="boxed" /></PageShell>;
	}
	const { tasks, sourceSummary, failureSummary } = await listOperationTaskResult();
	return (
		<PageShell maxW="max-w-7xl">
			<PageHeader eyebrow="Operations" title={tr("operationTasksPage.header.title")} description={tr("operationTasksPage.header.description")} />
			<OperationTaskListClient initialTasks={tasks} initialSourceSummary={sourceSummary} initialFailureSummary={failureSummary} />
		</PageShell>
	);
}
