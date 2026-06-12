import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listOperationTaskResult } from "@/lib/operation-task/service";
import { OperationTaskListClient } from "./operation-task-list-client";
import { PageShell, EmptyState } from "@/components/page-shell";

export const dynamic = "force-dynamic";

export default async function OperationTasksPage() {
	const session = await requireSession("/operation-tasks");
	if (!sessionHasPermission(session, "task:read")) {
		return <PageShell maxW="max-w-7xl"><EmptyState text="你没有任务中心查看权限。" variant="boxed" /></PageShell>;
	}
	const { tasks, sourceSummary, failureSummary } = await listOperationTaskResult();
	return (
		<PageShell maxW="max-w-7xl">
			<header className="mb-8">
				<p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">Operations</p>
				<h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">统一任务中心</h1>
				<p className="mt-1.5 text-sm text-slate-500">集中查看命令审批、定时任务、远程下载、同步扫描、备份和部署运行状态。</p>
			</header>
			<OperationTaskListClient initialTasks={tasks} initialSourceSummary={sourceSummary} initialFailureSummary={failureSummary} />
		</PageShell>
	);
}
