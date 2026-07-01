"use client";

import { useActionState, useMemo, useState } from "react";

import { SubmitButton } from "@/components/submit-button";

import { batchToggleServerAction, type ServerActionState } from "./actions";

const initialState: ServerActionState = {};

type BatchServerActionPanelProps = {
	servers: { id: string; name: string; enabled: boolean }[];
	enabledCount: number;
};

export function BatchServerActionPanel({ servers, enabledCount }: BatchServerActionPanelProps) {
	const [state, formAction] = useActionState(batchToggleServerAction, initialState);
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [disableConfirming, setDisableConfirming] = useState(false);
	const selectedServers = useMemo(
		() => servers.filter((server) => selectedIds.includes(server.id)),
		[servers, selectedIds],
	);
	const enabledSelectedCount = selectedServers.filter((server) => server.enabled).length;
	const disabledSelectedCount = selectedServers.length - enabledSelectedCount;
	const allSelected = selectedIds.length === servers.length && servers.length > 0;
	const someSelected = selectedIds.length > 0 && selectedIds.length < servers.length;

	const toggleAll = () => {
		setSelectedIds(allSelected ? [] : servers.map((server) => server.id));
		setDisableConfirming(false);
	};

	const updateSelection = (serverId: string, checked: boolean) => {
		setSelectedIds((current) =>
			checked ? Array.from(new Set([...current, serverId])) : current.filter((id) => id !== serverId),
		);
		setDisableConfirming(false);
	};

	return (
		<section data-card className="mb-8 ">
			<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
				<div>
					<h2 className="text-sm font-medium text-[var(--text-primary)]">批量节点操作</h2>
					<p className="mt-1 text-xs text-[var(--text-muted)]">先勾选节点，再统一启用或停用。适合维护窗口和巡检后的回收操作。</p>
				</div>
				<div className="text-xs text-[var(--text-muted)]">当前共有 {enabledCount} 台启用节点，已选中 {selectedServers.length} 台</div>
			</div>

			{state.error ? <div data-tone="rose" className="mt-4 rounded-lg border border-rose-400/20 px-3.5 py-2.5 text-sm text-rose-200">{state.error}</div> : null}
			{state.success ? <div data-tone="emerald" className="mt-4 rounded-lg border border-emerald-400/20 px-3.5 py-2.5 text-sm text-emerald-200">{state.success}</div> : null}

			<div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
				<button type="button" onClick={toggleAll} className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3 py-1.5 text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/[0.10]">
					{allSelected ? "清空选择" : "全选节点"}
				</button>
				<span>已选中：{selectedServers.length} 台</span>
				<span className="text-[var(--text-muted)]">·</span>
				<span>其中启用 {enabledSelectedCount} 台，停用 {disabledSelectedCount} 台</span>
				{someSelected ? <span className="text-[var(--color-action)]">当前为部分选择</span> : null}
			</div>

			<div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
				{servers.map((server) => (
					<label key={server.id} className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3 py-2.5 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/[0.10]">
						<input
							type="checkbox"
							checked={selectedIds.includes(server.id)}
							onChange={(event) => updateSelection(server.id, event.target.checked)}
							className="h-4 w-4 rounded-lg border-[var(--border)] bg-[var(--input-bg)] text-[var(--color-action)] focus:ring-[var(--color-action-ring)]"
						/>
						<div className="min-w-0">
							<div className="truncate font-medium text-[var(--text-primary)]">{server.name}</div>
							<div className="text-[11px] text-[var(--text-muted)]">{server.enabled ? "已启用" : "已停用"}</div>
						</div>
					</label>
				))}
			</div>

			<div className="mt-4 flex flex-wrap gap-3">
				<form action={formAction} className="flex flex-wrap items-center gap-3">
					<input type="hidden" name="enabled" value="false" />
					{selectedServers.map((server) => (
						<input key={server.id} type="hidden" name="serverIds" value={server.id} />
					))}
					{disableConfirming ? (
						<SubmitButton pendingLabel="处理中..." data-tone="rose" className="rounded-lg border border-rose-400/30 px-3.5 py-2 text-sm text-rose-100 transition hover:bg-rose-400/20">
							确认停用 {enabledSelectedCount} 台节点
						</SubmitButton>
					) : (
						<button
							type="button"
							disabled={enabledSelectedCount === 0}
							onClick={() => setDisableConfirming(true)}
							data-tone="amber" className="rounded-lg border border-amber-400/20 px-3.5 py-2 text-sm text-amber-100 transition hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-50"
						>
							批量停用所选节点
						</button>
					)}
					{disableConfirming ? (
						<button type="button" onClick={() => setDisableConfirming(false)} className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3.5 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/[0.10]">
							取消
						</button>
					) : null}
				</form>
				<form action={formAction} className="flex flex-wrap items-center gap-3">
					<input type="hidden" name="enabled" value="true" />
					{selectedServers.map((server) => (
						<input key={server.id} type="hidden" name="serverIds" value={server.id} />
					))}
					<SubmitButton pendingLabel="处理中..." disabled={disabledSelectedCount === 0} data-tone="emerald" className="rounded-lg border border-emerald-400/20 px-3.5 py-2 text-sm text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-50">
						批量启用所选节点
					</SubmitButton>
				</form>
			</div>
		</section>
	);
}
