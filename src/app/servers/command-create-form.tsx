"use client";

import { useActionState, useMemo, useState } from "react";

import { SubmitButton } from "@/components/submit-button";

import { createCommandRequestAction, type CommandActionState } from "./command-actions";

const initialState: CommandActionState = {};

type ServerOption = { id: string; name: string; host: string; enabled: boolean };

export function CommandCreateForm({
	servers,
}: {
	servers: ServerOption[];
}) {
	const [state, formAction] = useActionState(createCommandRequestAction, initialState);
	const enabledServerIds = useMemo(() => servers.filter((server) => server.enabled).map((server) => server.id), [servers]);
	const [selectedServerIds, setSelectedServerIds] = useState<Set<string>>(() => new Set());

	const toggleServer = (id: string) => {
		setSelectedServerIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const selectAll = () => {
		if (selectedServerIds.size === enabledServerIds.length) {
			setSelectedServerIds(new Set());
		} else {
			setSelectedServerIds(new Set(enabledServerIds));
		}
	};

	return (
		<form action={formAction} data-card className="grid gap-4  p-5">
			<div>
				<h2 className="text-lg font-semibold text-white">下发命令</h2>
				<p className="mt-1 text-xs text-slate-500">向选中的 VPS 节点发送待审批命令</p>
			</div>

			{state.error && <div className="rounded-lg bg-rose-500/[0.08] border border-rose-400/20 px-3.5 py-2.5 text-sm text-rose-200 light:text-rose-800">{state.error}</div>}
			{state.success && <div className="rounded-lg bg-emerald-500/[0.08] border border-emerald-400/20 px-3.5 py-2.5 text-sm text-emerald-200 light:text-emerald-800">{state.success}</div>}

			<div className="space-y-1.5">
				<label className="text-xs font-medium text-white/50 tracking-wide" htmlFor="cmdTitle">命令标题</label>
				<input id="cmdTitle" name="title" type="text" required placeholder="例如 检查磁盘空间" className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30 focus:bg-white/[0.06]" />
			</div>

			<div className="space-y-1.5">
				<label className="text-xs font-medium text-white/50 tracking-wide" htmlFor="cmdCommand">命令内容</label>
				<textarea id="cmdCommand" name="command" rows={4} required placeholder="df -h" className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white font-mono outline-none transition placeholder:text-white/20 focus:border-cyan-400/30 focus:bg-white/[0.06] resize-y" />
			</div>

			<div className="space-y-1.5">
				<label className="text-xs font-medium text-white/50 tracking-wide" htmlFor="cmdReason">原因 / 备注</label>
				<textarea id="cmdReason" name="reason" rows={2} placeholder="可选" className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-400/30 focus:bg-white/[0.06] resize-y" />
			</div>

			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<label className="text-xs font-medium text-white/50 tracking-wide">目标节点</label>
					<button type="button" onClick={selectAll} className="text-xs text-cyan-400/70 hover:text-cyan-300 light:hover:text-cyan-700 transition">
						{selectedServerIds.size === enabledServerIds.length ? "取消全选" : "全选启用节点"}
					</button>
				</div>
				{servers.length === 0 ? (
					<p className="text-xs text-slate-500">暂无可用节点。</p>
				) : (
					<div className="grid gap-1.5 sm:grid-cols-2">
						{servers.map((server) => (
							<label
								key={server.id}
								className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm cursor-pointer transition ${
									!server.enabled
										?"border-white/[0.04] bg-white/[0.01] text-slate-600 cursor-not-allowed opacity-50"
										: selectedServerIds.has(server.id)
											?"border-cyan-400/20 bg-cyan-400/[0.06] text-white"
											:"border-white/[0.06] bg-white/[0.03] text-slate-300 light:text-slate-700 hover:bg-white/[0.05]"
								}`}
							>
								<input
									type="checkbox"
									name="serverIds"
									value={server.id}
									checked={selectedServerIds.has(server.id)}
									disabled={!server.enabled}
									onChange={() => toggleServer(server.id)}
									className="accent-cyan-400"
								/>
								<span>{server.name}</span>
								<span className="ml-auto text-[11px] text-slate-500">{server.host}</span>
							</label>
						))}
					</div>
				)}
			</div>

			<SubmitButton pendingLabel="提交中…">提交命令</SubmitButton>
		</form>
	);
}
