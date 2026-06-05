import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listShareLinks } from "@/lib/share-link/service";
import { listStorageNodes } from "@/lib/storage/service";
import Link from "next/link";
import { PageShell, EmptyState } from "@/components/page-shell";
import { CreateShareForm } from "./create-share-form";
import { ShareRowActions } from "./share-row-actions";

export const dynamic = "force-dynamic";

export default async function SharesPage() {
	const session = await requireSession("/shares");
	if (!sessionHasPermission(session, "share:read")) return <PageShell><EmptyState text="你没有分享链接查看权限。" /></PageShell>;
	const [shares, nodes] = await Promise.all([listShareLinks(), listStorageNodes()]);
	const canCreate = sessionHasPermission(session, "share:create");
	const canManage = sessionHasPermission(session, "share:manage");

	return (
		<PageShell>
			<header className="mb-8">
				<p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300 light:text-cyan-700/70">Sharing</p>
				<h1 className="mt-2 text-3xl font-semibold tracking-tight text-white light:text-slate-900">文件分享链接</h1>
				<p className="mt-1.5 text-sm text-slate-500">管理从文件管理中真实文件生成的可撤销、可过期分享链接；数据库仅保存 token 哈希。</p>
			</header>

			{canCreate ? (
				<div className="mb-6 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
					<div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] p-4">
						<div className="text-sm font-semibold text-white light:text-slate-900">快捷分享真实文件</div>
						<p className="mt-1 text-sm text-slate-400 light:text-slate-600">进入文件与存储管理，在具体文件行点击「分享」。适合单个真实文件，自动带入节点和路径。</p>
						<Link href="/files" className="mt-3 inline-flex rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white light:text-slate-900 transition hover:bg-cyan-500">去文件管理选择文件</Link>
					</div>
					<CreateShareForm nodes={nodes.map((n) => ({ id: n.id, name: `${n.name} · ${n.driver}` }))} />
				</div>
			) : null}

			<div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
				<div className="border-b border-white/[0.06] px-5 py-4 text-sm font-semibold text-white light:text-slate-900">分享记录</div>
				<div className="divide-y divide-white/[0.06]">
					{shares.length === 0 ? <EmptyState text="暂无分享链接" /> : shares.map((s) => (
						<div key={s.id} className="px-5 py-4">
							<div className="flex items-center justify-between gap-3">
								<div>
									<h3 className="text-sm font-medium text-white light:text-slate-900">{s.name || s.path}</h3>
									<p className="mt-1 text-xs text-slate-500">{s.storageNode.name} · {s.path} · 访问 {s.accessCount} 次</p>
								</div>
								<div className="flex items-center gap-3">
								<span className="rounded-md border border-white/[0.08] px-2 py-1 text-xs text-slate-400 light:text-slate-600">
									{s.revokedAt ? "已撤销" : s.expiresAt && s.expiresAt < new Date() ? "已过期" : "有效"}
								</span>
								{canManage ? <ShareRowActions id={s.id} revoked={Boolean(s.revokedAt)} /> : null}
							</div>
							</div>
							<p className="mt-2 text-xs text-slate-500">创建：{s.createdAt.toLocaleString("zh-CN")} · 到期：{s.expiresAt?.toLocaleString("zh-CN") ?? "永不过期"}</p>
						</div>
					))}
				</div>
			</div>
		</PageShell>
	);
}
