"use client";

import { useState } from "react";

type TabKey = "nodes" | "sshkeys";

const tabs: { key: TabKey; label: string }[] = [
	{ key: "nodes", label: "VPS 节点" },
	{ key: "sshkeys", label: "SSH 密钥" },
];

export function ServerTabLayout({
	nodesPanel,
	sshKeysPanel,
}: {
	nodesPanel: React.ReactNode;
	sshKeysPanel: React.ReactNode;
}) {
	const [activeTab, setActiveTab] = useState<TabKey>("nodes");

	const panels: Record<TabKey, React.ReactNode> = {
		nodes: nodesPanel,
		sshkeys: sshKeysPanel,
	};

	return (
		<div>
			{/* Tab Bar */}
			<div className="flex gap-1 rounded-xl bg-white/[0.03] border border-white/[0.06] p-1 mb-6">
				{tabs.map((tab) => (
					<button
						key={tab.key}
						onClick={() => setActiveTab(tab.key)}
						className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-150 ${
							activeTab === tab.key
								? "bg-cyan-400/10 text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.15)]"
								: "text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]"
						}`}
					>
						{tab.label}
					</button>
				))}
			</div>

			{/* Panel */}
			<div>{panels[activeTab]}</div>
		</div>
	);
}
