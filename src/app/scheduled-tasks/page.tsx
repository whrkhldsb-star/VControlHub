import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listScheduledTasks, describeCron } from "@/lib/scheduled-task/service";
import { listServerProfiles } from "@/lib/server/service";

import { ScheduledTaskListClient } from "./scheduled-task-list-client";

export const dynamic = "force-dynamic";

export default async function ScheduledTasksPage() {
	const session = await requireSession();
	const canCreate = sessionHasPermission(session, "command:create");

	const [tasks, servers] = await Promise.all([
		listScheduledTasks(),
		listServerProfiles(),
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
		<main className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b,transparent_40%),linear-gradient(180deg,#0f172a_0%,#020617_100%)] text-slate-100">
			<div className="mx-auto max-w-6xl px-6 py-10 lg:px-10">
				<header className="mb-8">
					<h1 className="text-3xl font-semibold tracking-tight text-white">定时任务</h1>
					<p className="mt-1.5 text-sm text-slate-500">
						配置 Cron 表达式，自动向 VPS 节点下发待审批命令
					</p>
				</header>
				<ScheduledTaskListClient tasks={serialized} servers={serverOptions} canCreate={canCreate} />
			</div>
		</main>
	);
}
