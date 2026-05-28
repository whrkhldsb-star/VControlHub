"use client";

import { useActionState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";

export function CreateTicketForm() {
	const [state, formAction, pending] = useActionState(async (_prev: { error?: string } | null, formData: FormData) => {
		const title = String(formData.get("subject") ?? "").trim();
		const description = String(formData.get("description") ?? "").trim();
		const priority = String(formData.get("priority") ?? "NORMAL").toUpperCase();
		if (!title || !description) return { error: "标题和描述不能为空" };
		try {
			await csrfFetch("/api/tickets", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ subject: title, description, priority }),
			});
			window.location.reload();
			return null;
		} catch (err) {
			return { error: err instanceof Error ? err.message : "创建失败" };
		}
	}, null);

	return (
		<form action={formAction} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
			<h2 className="text-sm font-semibold text-white">新建工单</h2>
			{state?.error && <p className="text-xs text-rose-400">{state.error}</p>}
			<div className="grid gap-3 md:grid-cols-2">
				<label className="grid gap-1.5 text-xs font-medium text-slate-400">
					标题
					<input name="subject" required placeholder="简要描述问题" className="rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600" />
				</label>
				<label className="grid gap-1.5 text-xs font-medium text-slate-400">
					优先级
					<select name="priority" defaultValue="NORMAL" className="rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100">
						<option value="LOW">低</option>
						<option value="NORMAL">普通</option>
						<option value="HIGH">高</option>
						<option value="URGENT">紧急</option>
					</select>
				</label>
			</div>
			<label className="grid gap-1.5 text-xs font-medium text-slate-400">
				描述
				<textarea name="description" required rows={4} placeholder="详细描述你的需求或遇到的问题" className="rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 resize-y" />
			</label>
			<button disabled={pending} className="w-fit rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60">
				{pending ? "提交中…" : "提交工单"}
			</button>
		</form>
	);
}
