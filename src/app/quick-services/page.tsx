import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { PageShell } from "@/components/page-shell";
import { QuickServicesClient } from "./quick-services-client";

export const dynamic = "force-dynamic";

export default async function QuickServicesPage() {
	const session = await requireSession("/quick-services");
	const canManage = sessionHasPermission(session, "user:manage");

	return (
		<PageShell>
			<header className="mb-8">
				<p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300/70">Quick Services</p>
				<h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">快捷服务</h1>
				<p className="mt-1.5 text-sm text-slate-500">一键安装常用自托管服务，自动 Docker 部署，安装即用。</p>
			</header>
			<QuickServicesClient canManage={canManage} />
		</PageShell>
	);
}
