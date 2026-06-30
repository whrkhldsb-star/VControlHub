import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listOperationTaskResult } from "@/lib/operation-task/service";
import { OperationTaskListClient } from "./operation-task-list-client";
import { PageShell, EmptyState, PageHeader } from "@/components/page-shell";

export const revalidate = 30;

export default async function OperationTasksPage() {
	const session = await requireSession("/operation-tasks");
	if (!sessionHasPermission(session, "task:read")) {
		return <PageShell maxW="max-w-7xl"><EmptyState text="你没有任务中心查看权限。" variant="boxed" /></PageShell>;
	}
	const { tasks, sourceSummary, failureSummary } = await listOperationTaskResult();
	return (
		<PageShell maxW="max-w-7xl">
			<PageHeader eyebrow="Operations" title="统一任务中心" description="集中查看命令审批、定时任务、远程下载、同步扫描、备份和部署运行状态。" />
			<OperationTaskListClient initialTasks={tasks} initialSourceSummary={sourceSummary} initialFailureSummary={failureSummary} />
		</PageShell>
	);
}
