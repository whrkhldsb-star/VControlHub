import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listOperationTasks } from "@/lib/operation-task/service";

import { OperationTaskListClient } from "./operation-task-list-client";

export const dynamic = "force-dynamic";

export default async function OperationTasksPage() {
  const session = await requireSession("/operation-tasks");
  if (!sessionHasPermission(session, "task:read")) {
    return <Shell><EmptyState text="你没有任务中心查看权限。" /></Shell>;
  }
  const tasks = await listOperationTasks({ limit: 100 });
  return (
    <Shell>
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300/70">Operations</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">统一任务中心</h1>
        <p className="mt-1.5 text-sm text-slate-500">集中查看命令审批、定时任务、远程下载、同步扫描、备份和部署运行状态。</p>
      </header>
      <OperationTaskListClient initialTasks={tasks} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b,transparent_40%),linear-gradient(180deg,#0f172a_0%,#020617_100%)] text-slate-100"><div className="mx-auto max-w-7xl px-6 py-10 lg:px-10">{children}</div></main>;
}
function EmptyState({ text }: { text: string }) { return <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-8 text-center text-sm text-slate-500">{text}</div>; }
