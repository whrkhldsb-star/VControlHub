"use client";

import { useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/use-locale";

type PanelKey = "nodes" | "create" | "sshkeys" | "batch";

const actions: { key: PanelKey; labelKey: string }[] = [
	{ key: "nodes", labelKey: "serversPage.tabs.overview" },
	{ key: "create", labelKey: "serversPage.tabs.addVps" },
	{ key: "sshkeys", labelKey: "serversPage.tabs.addKey" },
	{ key: "batch", labelKey: "serversPage.tabs.batch" },
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
	const { t } = useI18n();
	const [activePanel, setActivePanel] = useState<PanelKey>("nodes");

	const panels: Record<PanelKey, ReactNode> = {
		nodes: nodesPanel,
		create: createPanel,
		sshkeys: sshKeysPanel,
		batch: batchPanel,
	};

	return (
		<div className="space-y-5">
			<section data-card aria-label={t("serversPage.quickActionsAria")} className="p-2">
				<div className="grid gap-2 md:grid-cols-4">
					{actions.map((action) => {
						const disabled = !panels[action.key];
						return (
							<button
								key={action.key}
								type="button"
								onClick={() => !disabled && setActivePanel(action.key)}
								disabled={disabled}
								className={`rounded-xl border px-4 py-3 text-left transition-colors duration-150 ${
									activePanel === action.key
										?"border-[var(--color-action-border)]/25 bg-[var(--color-action-bg)]/10 text-[var(--text-primary)] shadow-[0_0_0_1px_rgba(34,211,238,0.1)]"
										:"border-[var(--border)] bg-[var(--surface)]/[0.04] text-[var(--text-secondary)] hover:bg-[var(--surface)]/[0.10]"
								} ${disabled ?"cursor-not-allowed opacity-45" :""}`}
							>
								<div className="text-sm font-medium">{t(action.labelKey)}</div>
							</button>
						);
					})}
				</div>
			</section>

			<div>{panels[activePanel]}</div>
		</div>
	);
}
