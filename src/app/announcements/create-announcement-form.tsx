"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";

export function CreateAnnouncementForm() {
	const router = useRouter();
	const titleId = useId();
	const typeId = useId();
	const contentId = useId();
	const startsAtId = useId();
	const expiresAtId = useId();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setLoading(true);
		setError(null);
		const form = event.currentTarget;
		const data = Object.fromEntries(new FormData(form));
		try {
			await csrfFetch("/api/announcements", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: data.title,
					content: data.content,
					type: data.type || "info",
					startsAt: data.startsAt || undefined,
					expiresAt: data.expiresAt || undefined,
				}),
			});
			form.reset();
			router.refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : "创建失败");
		} finally {
			setLoading(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} data-card className=" p-5 space-y-4">
			<h2 className="text-sm font-semibold text-white">发布公告</h2>
			{error && <p className="text-xs text-rose-400">{error}</p>}
			<div className="grid gap-3 md:grid-cols-2">
				<div className="grid gap-1.5">
					<label htmlFor={titleId} className="text-xs font-medium text-[var(--text-secondary)]">标题</label>
					<input id={titleId} name="title" required aria-describedby={`${titleId}-hint`} className="rounded-lg border border-white/[0.08] bg-slate-950 light:bg-white px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 light:placeholder:text-slate-500" />
					<p id={`${titleId}-hint`} className="text-[11px] text-slate-500">显示在站内公告列表和用户通知区域的公告标题。</p>
				</div>
				<div className="grid gap-1.5">
					<label htmlFor={typeId} className="text-xs font-medium text-[var(--text-secondary)]">类型</label>
					<select id={typeId} name="type" defaultValue="info" className="rounded-lg border border-white/[0.08] bg-slate-950 light:bg-white px-3 py-2 text-sm text-slate-100">
						<option value="info">信息</option>
						<option value="warning">警告</option>
						<option value="urgent">🔴 紧急</option>
					</select>
					<p className="text-[11px] text-slate-500">紧急公告会使用更醒目的状态样式。</p>
				</div>
			</div>
			<div className="grid gap-1.5">
				<label htmlFor={contentId} className="text-xs font-medium text-[var(--text-secondary)]">内容</label>
				<textarea id={contentId} name="content" required rows={3} aria-describedby={`${contentId}-hint`} className="rounded-lg border border-white/[0.08] bg-slate-950 light:bg-white px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 light:placeholder:text-slate-500 resize-y" />
				<p id={`${contentId}-hint`} className="text-[11px] text-slate-500">写清影响范围、时间窗口和用户需要执行的操作。</p>
			</div>
			<div className="grid gap-3 md:grid-cols-2">
				<div className="grid gap-1.5">
					<label htmlFor={startsAtId} className="text-xs font-medium text-[var(--text-secondary)]">生效时间</label>
					<input id={startsAtId} type="datetime-local" name="startsAt" aria-describedby={`${startsAtId}-hint`} className="rounded-lg border border-white/[0.08] bg-slate-950 light:bg-white px-3 py-2 text-sm text-slate-100" />
					<p id={`${startsAtId}-hint`} className="text-[11px] text-slate-500">留空表示立即生效。</p>
				</div>
				<div className="grid gap-1.5">
					<label htmlFor={expiresAtId} className="text-xs font-medium text-[var(--text-secondary)]">过期时间</label>
					<input id={expiresAtId} type="datetime-local" name="expiresAt" aria-describedby={`${expiresAtId}-hint`} className="rounded-lg border border-white/[0.08] bg-slate-950 light:bg-white px-3 py-2 text-sm text-slate-100" />
					<p id={`${expiresAtId}-hint`} className="text-[11px] text-slate-500">留空表示永不过期。</p>
				</div>
			</div>
			<button disabled={loading} className="w-fit rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60">
				{loading ? "发布中…" : "发布公告"}
			</button>
		</form>
	);
}
