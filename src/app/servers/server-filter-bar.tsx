"use client";

import { useState, useMemo } from "react";

/* ── Types ────────────────────────────────────────────────── */

type ServerItem = {
	id: string; name: string; host: string; port: number; enabled: boolean;
	tags: string[]; description?: string; pendingCommandCount: number;
};

type Props = {
	servers: ServerItem[];
	children: (filteredServers: ServerItem[], selectedIds: Set<string>, actions: {
		toggleSelect: (id: string) => void;
		selectAll: () => void;
		clearSelection: () => void;
		activeTag: string | null;
		setActiveTag: (tag: string | null) => void;
	}) => React.ReactNode;
};

export function ServerFilterBar({ servers, children }: Props) {
	const [activeTag, setActiveTag] = useState<string | null>(null);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

	// Extract all unique tags
	const allTags = useMemo(() => {
		const tagSet = new Set<string>();
		servers.forEach((s) => (s.tags ?? []).forEach((t) => tagSet.add(t)));
		return [...tagSet].sort();
	}, [servers]);

	// Filter by tag
	const filteredServers = useMemo(() => {
		if (!activeTag) return servers;
		return servers.filter((s) => (s.tags ?? []).includes(activeTag));
	}, [servers, activeTag]);

	const toggleSelect = (id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id); else next.add(id);
			return next;
		});
	};

	const selectAll = () => {
		setSelectedIds(new Set(filteredServers.map((s) => s.id)));
	};

	const clearSelection = () => {
		setSelectedIds(new Set());
	};

	return (
		<div>
			{/* Tag filter bar */}
			{allTags.length > 0 && (
				<div className="mb-4 flex flex-wrap items-center gap-2">
					<span className="text-xs text-slate-500 shrink-0">标签筛选</span>
					<button
						onClick={() => setActiveTag(null)}
						className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
							activeTag === null
								? "border-cyan-400/30 bg-cyan-400/10 text-cyan-200"
								: "border-white/[0.06] bg-white/[0.02] text-slate-500 hover:bg-white/[0.05]"
						}`}
					>
						全部
					</button>
					{allTags.map((tag) => (
						<button
							key={tag}
							onClick={() => setActiveTag(activeTag === tag ? null : tag)}
							className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
								activeTag === tag
									? "border-cyan-400/30 bg-cyan-400/10 text-cyan-200"
									: "border-white/[0.06] bg-white/[0.02] text-slate-400 hover:bg-white/[0.05]"
							}`}
						>
							#{tag}
						</button>
					))}
				</div>
			)}

			{/* Batch action bar */}
			{selectedIds.size > 0 && (
				<div className="mb-4 flex items-center gap-3 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] px-4 py-2.5">
					<span className="text-xs text-cyan-200">已选 {selectedIds.size} 台</span>
					<button onClick={selectAll} className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-[11px] text-slate-300 hover:bg-white/[0.06] transition">
						全选当前
					</button>
					<button onClick={clearSelection} className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-[11px] text-slate-300 hover:bg-white/[0.06] transition">
						取消选择
					</button>
					<BatchCommandButton selectedIds={selectedIds} filteredServers={filteredServers} />
				</div>
			)}

			{children(filteredServers, selectedIds, {
				toggleSelect,
				selectAll,
				clearSelection,
				activeTag,
				setActiveTag,
			})}
		</div>
	);
}

/* ── Batch command button ─────────────────────────────────── */

function BatchCommandButton({ selectedIds }: { selectedIds: Set<string>; filteredServers: ServerItem[] }) {
	const [open, setOpen] = useState(false);
	const [command, setCommand] = useState("");
	const [submitting, setSubmitting] = useState(false);

	const handleSubmit = async () => {
		if (!command.trim()) return;
		setSubmitting(true);
		try {
			const res = await fetch("/api/commands", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: `批量命令 (${selectedIds.size}台)`,
					command,
 serverIds: [...selectedIds],
				}),
			});
			if (res.ok) {
				setCommand("");
				setOpen(false);
				alert("命令已提交，等待审批");
			}
		} catch { /* ignore */ }
		setSubmitting(false);
	};

	if (!open) {
		return (
			<button onClick={() => setOpen(true)} className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] text-cyan-200 hover:bg-cyan-400/20 transition">
				批量下发命令
			</button>
		);
	}

	return (
		<div className="flex items-center gap-2">
			<input
				value={command}
				onChange={(e) => setCommand(e.target.value)}
				placeholder="输入命令…"
				className="rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-1.5 text-xs text-white font-mono outline-none focus:border-cyan-400/30 placeholder:text-white/20 w-48"
				onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
			/>
			<button onClick={handleSubmit} disabled={submitting} className="rounded-lg bg-cyan-500 px-3 py-1 text-[11px] font-medium text-slate-950 hover:bg-cyan-400 disabled:opacity-60 transition">
				{submitting ? "提交中…" : "提交"}
			</button>
			<button onClick={() => setOpen(false)} className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-[11px] text-slate-400 hover:bg-white/[0.06] transition">
				取消
			</button>
		</div>
	);
}
