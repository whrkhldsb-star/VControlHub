import { requireSession } from "@/lib/auth/require-session";
import { listServerProfiles } from "@/lib/server/service";

import { HealthDashboardClient } from "./health-dashboard-client";

export const dynamic = "force-dynamic";

export default async function HealthPage() {
	await requireSession("/health");
	const servers = await listServerProfiles();

	return (
		<main className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b,transparent_40%),linear-gradient(180deg,#0f172a_0%,#020617_100%)] text-slate-100">
			<div className="mx-auto max-w-7xl px-6 py-10 lg:px-10">
				<header className="mb-8">
					<h1 className="text-3xl font-semibold tracking-tight text-white">健康看板</h1>
					<p className="mt-1.5 text-sm text-slate-500">
						全局节点健康态势一览，异常自动标红
					</p>
				</header>
				<HealthDashboardClient serverCount={servers.length} />
			</div>
		</main>
	);
}
