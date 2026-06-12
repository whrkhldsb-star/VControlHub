import Link from "next/link";
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { PageShell, PageHeader } from "@/components/page-shell";
import { QuickServicesClient } from "./quick-services-client";

export const dynamic = "force-dynamic";

export default async function QuickServicesPage() {
	const session = await requireSession("/quick-services");
	const canManage = sessionHasPermission(session, "docker:manage");

	return (
		<PageShell>
			<PageHeader eyebrow="Quick Services" title="快捷服务" description="一键安装常用自托管服务，自动 Docker 部署，安装即用。">
				<div className="flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]">
					<Link href="/deployments" className="rounded-full border border-[var(--border)] bg-white/[0.03] px-3 py-1.5 transition hover:bg-white/[0.06]">部署面板</Link>
					<Link href="/docker" className="rounded-full border border-[var(--border)] bg-white/[0.03] px-3 py-1.5 transition hover:bg-white/[0.06]">Docker 容器</Link>
					<Link href="/files" className="rounded-full border border-[var(--border)] bg-white/[0.03] px-3 py-1.5 transition hover:bg-white/[0.06]">文件管理</Link>
				</div>
			</PageHeader>
			<QuickServicesClient canManage={canManage} />
		</PageShell>
	);
}
