import Link from "next/link";
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { PageShell } from "@/components/page-shell";
import { QuickServicesClient } from "./quick-services-client";

export const dynamic = "force-dynamic";

export default async function QuickServicesPage() {
	const session = await requireSession("/quick-services");
	const canManage = sessionHasPermission(session, "docker:manage");

	return (
		<PageShell>
			<header className="mb-8">
				<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
					<div>
						<p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300 light:text-cyan-700/70">Quick Services</p>
						<h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">快捷服务</h1>
						<p className="mt-1.5 text-sm text-slate-500">一键安装常用自托管服务，自动 Docker 部署，安装即用。</p>
					</div>
					<div className="flex flex-wrap gap-2 text-xs text-slate-400 light:text-slate-600">
						<Link href="/deployments" className="rounded-full border border-white/10 light:border-slate-200 bg-white/[0.03] px-3 py-1.5 transition hover:bg-white/[0.06]">部署面板</Link>
						<Link href="/docker" className="rounded-full border border-white/10 light:border-slate-200 bg-white/[0.03] px-3 py-1.5 transition hover:bg-white/[0.06]">Docker 容器</Link>
						<Link href="/files" className="rounded-full border border-white/10 light:border-slate-200 bg-white/[0.03] px-3 py-1.5 transition hover:bg-white/[0.06]">文件管理</Link>
					</div>
				</div>
			</header>
			<QuickServicesClient canManage={canManage} />
		</PageShell>
	);
}
