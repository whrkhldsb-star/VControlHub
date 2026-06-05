"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";

export function CreateAnnouncementForm() {
	const router = useRouter();
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
		<form onSubmit={handleSubmit} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
			<h2 className="text-sm font-semibold text-white light:text-slate-900">发布公告</h2>
			{error && <p className="text-xs text-rose-400">{error}</p>}
			<div className="grid gap-3 md:grid-cols-2">
				<label className="grid gap-1.5 text-xs font-medium text-slate-400 light:text-slate-600">
					标题
					<input name="title" required placeholder="公告标题" className="rounded-lg border border-white/[0.08] bg-slate-950 light:bg-white px-3 py-2 text-sm text-slate-100 light:text-slate-900 placeholder:text-slate-600 light:placeholder:text-slate-500" />
				</label>
				<label className="grid gap-1.5 text-xs font-medium text-slate-400 light:text-slate-600">
					类型
					<select name="type" defaultValue="info" className="rounded-lg border border-white/[0.08] bg-slate-950 light:bg-white px-3 py-2 text-sm text-slate-100 light:text-slate-900">
						<option value="info">信息</option>
						<option value="warning">警告</option>
						<option value="urgent">🔴 紧急</option>
					</select>
				</label>
			</div>
			<label className="grid gap-1.5 text-xs font-medium text-slate-400 light:text-slate-600">
				内容
				<textarea name="content" required rows={3} placeholder="公告内容" className="rounded-lg border border-white/[0.08] bg-slate-950 light:bg-white px-3 py-2 text-sm text-slate-100 light:text-slate-900 placeholder:text-slate-600 light:placeholder:text-slate-500 resize-y" />
			</label>
			<div className="grid gap-3 md:grid-cols-2">
				<label className="grid gap-1.5 text-xs font-medium text-slate-400 light:text-slate-600">
					生效时间（留空=立即）
					<input type="datetime-local" name="startsAt" className="rounded-lg border border-white/[0.08] bg-slate-950 light:bg-white px-3 py-2 text-sm text-slate-100 light:text-slate-900" />
				</label>
				<label className="grid gap-1.5 text-xs font-medium text-slate-400 light:text-slate-600">
					过期时间（留空=永不过期）
					<input type="datetime-local" name="expiresAt" className="rounded-lg border border-white/[0.08] bg-slate-950 light:bg-white px-3 py-2 text-sm text-slate-100 light:text-slate-900" />
				</label>
			</div>
			<button disabled={loading} className="w-fit rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60">
				{loading ? "发布中…" : "发布公告"}
			</button>
		</form>
	);
}
