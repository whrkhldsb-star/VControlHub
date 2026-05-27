"use client";

import { useState, type ReactNode } from "react";

type PanelKey = "nodes" | "create" | "sshkeys" | "batch";

const actions: { key: PanelKey; label: string }[] = [
	{ key: "nodes", label: "VPS 总览" },
	{ key: "create", label: "添加 VPS" },
	{ key: "sshkeys", label: "添加密钥" },
	{ key: "batch", label: "批量操作" },
];

export function ServerTabLayout({
	nodesPanel,
	createPanel,
	sshKeysPanel,
	batchPanel,
}: {
	nodesPanel: ReactNode;
	createPanel?: ReactNode;
	sshKeysPanel: ReactNode;
	batchPanel?: ReactNode;
}) {
	const [activePanel, setActivePanel] = useState<PanelKey>("nodes");

	const panels: Record<PanelKey, ReactNode> = {
		nodes: nodesPanel,
		create: createPanel,
		sshkeys: sshKeysPanel,
		batch: batchPanel,
	};

	return (
		<div className="space-y-5">
			<section aria-label="VPS 管理快捷操作" className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-2">
				<div className="grid gap-2 md:grid-cols-4">
					{actions.map((action) => {
						const disabled = !panels[action.key];
						return (
							<button
								key={action.key}
								type="button"
								onClick={() => !disabled && setActivePanel(action.key)}
								disabled={disabled}
								className={`rounded-xl border px-4 py-3 text-left transition-all duration-150 ${
									activePanel === action.key
										? "border-cyan-400/25 bg-cyan-400/10 text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.1)]"
										: "border-white/[0.06] bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]"
								} ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
							>
								<div className="text-sm font-medium">{action.label}</div>
							</button>
						);
					})}
				</div>
			</section>

			<div>{panels[activePanel]}</div>
		</div>
	);
}
