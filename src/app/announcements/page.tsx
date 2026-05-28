import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listActiveAnnouncements } from "@/lib/announcement/service";
import { PageShell, EmptyState } from "@/components/page-shell";
import { CreateAnnouncementForm } from "./create-announcement-form";

export const dynamic = "force-dynamic";

const levelColors: Record<string, string> = {
	info: "border-cyan-400/20 bg-cyan-400/[0.04]",
	warning: "border-amber-400/20 bg-amber-400/[0.04]",
	critical: "border-rose-400/20 bg-rose-400/[0.04]",
};

const levelLabels: Record<string, string> = {
	info: "ℹ️ 信息",
	warning: "⚠️ 警告",
	critical: "🔴 严重",
};

export default async function AnnouncementsPage() {
	const session = await requireSession("/announcements");
	const canManage = sessionHasPermission(session, "announcement:manage");
	const items = await listActiveAnnouncements();
	return (
		<PageShell maxW="max-w-4xl">
			<header className="mb-6">
				<p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300/70">Announcements</p>
				<h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">站内公告</h1>
				<p className="mt-1.5 text-sm text-slate-500">展示当前有效、置顶优先的站内消息。</p>
			</header>

			{canManage && <div className="mb-6"><CreateAnnouncementForm /></div>}

			<div className="grid gap-4">
				{items.length === 0 ? (
					<EmptyState text="暂无公告" />
				) : items.map((a) => (
					<div key={a.id} className={`rounded-xl border p-5 ${levelColors[a.level] ?? levelColors.info}`}>
						<div className="flex items-start justify-between gap-3">
							<div>
								<div className="flex items-center gap-2">
									{a.pinned && <span className="text-xs text-amber-400">📌 置顶</span>}
									<span className="text-xs text-slate-500">{levelLabels[a.level] ?? a.level}</span>
								</div>
								<h2 className="mt-1 text-base font-semibold text-white">{a.title}</h2>
							</div>
							<span className="text-xs text-slate-500 whitespace-nowrap">{new Date(a.startsAt).toLocaleDateString("zh-CN")}</span>
						</div>
						<p className="mt-3 text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">{a.body}</p>
						{a.expiresAt && (
							<p className="mt-3 text-xs text-slate-500">有效期至 {new Date(a.expiresAt).toLocaleString("zh-CN")}</p>
						)}
					</div>
				))}
			</div>
		</PageShell>
	);
}
