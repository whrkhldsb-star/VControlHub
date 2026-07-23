import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listOperationTaskResult } from "@/lib/operation-task/service";
import { OperationTaskListClient } from "./operation-task-list-client";
import { PageShell, EmptyState, PageHeader } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const revalidate = 30;

function firstParam(value: string | string[] | undefined): string | undefined {
	if (Array.isArray(value)) return value[0];
	return value;
}

export default async function OperationTasksPage({
	searchParams,
}: {
	searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
	const session = await requireSession("/operation-tasks");
	const locale = await getServerLocale();
	const tr = (key: string) => t(key, locale);
	if (!sessionHasPermission(session, "task:read")) {
		return <PageShell maxW="max-w-7xl"><EmptyState text={tr("operationTasksPage.noPermission")} variant="boxed" /></PageShell>;
	}
	const resolved = (await searchParams) ?? {};
	const statusRaw = firstParam(resolved.status) ?? "all";
	const taskTypeRaw = firstParam(resolved.type) ?? firstParam(resolved.taskType) ?? "all";
	const sortRaw = firstParam(resolved.sort) ?? "recent";
	const statusFilter =
		statusRaw === "attention"
			? (["failed", "running", "pending"] as const)
			: statusRaw === "all"
				? undefined
				: statusRaw.includes(",")
					? statusRaw.split(",").map((s) => s.trim()).filter(Boolean)
					: statusRaw;
	const { tasks, sourceSummary, failureSummary } = await listOperationTaskResult(
		{
			...(statusFilter ? { status: statusFilter as never } : {}),
			...(taskTypeRaw !== "all" ? { taskType: taskTypeRaw } : {}),
			...(sortRaw !== "recent" ? { sort: sortRaw as never } : {}),
		},
		session,
	);
	return (
		<PageShell maxW="max-w-7xl">
			<PageHeader eyebrow={t("operationTasksPage.eyebrow", locale)} title={tr("operationTasksPage.header.title")} description={tr("operationTasksPage.header.description")} />
			<OperationTaskListClient initialTasks={tasks} initialSourceSummary={sourceSummary} initialFailureSummary={failureSummary} />
		</PageShell>
	);
}
