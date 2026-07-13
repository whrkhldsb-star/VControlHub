"use client";

import { useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/use-locale";

type PanelKey = "nodes" | "create" | "sshkeys" | "batch";

const actions: {
	key: PanelKey;
	labelKey: string;
	hintKey: string;
	icon: ReactNode;
}[] = [
	{
		key: "nodes",
		labelKey: "serversPage.tabs.overview",
		hintKey: "serversPage.tabs.overviewHint",
		icon: (
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
				<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
			</svg>
		),
	},
	{
		key: "create",
		labelKey: "serversPage.tabs.addVps",
		hintKey: "serversPage.tabs.addVpsHint",
		icon: (
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
				<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 5v14M5 12h14" />
			</svg>
		),
	},
	{
		key: "sshkeys",
		labelKey: "serversPage.tabs.addKey",
		hintKey: "serversPage.tabs.addKeyHint",
		icon: (
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
				<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.857L8 16H6v2H4v2H2v-2.586l7.44-7.44A6 6 0 0121 9z" />
			</svg>
		),
	},
	{
		key: "batch",
		labelKey: "serversPage.tabs.batch",
		hintKey: "serversPage.tabs.batchHint",
		icon: (
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
				<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4 6h16M4 12h10M4 18h7" />
			</svg>
		),
	},
];

function tabLabel(t: (k: string) => string, key: string, fallback: string) {
	const value = t(key);
	return value === key ? fallback : value;
}

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

	const hints: Record<PanelKey, string> = {
		nodes: tabLabel(t, "serversPage.tabs.overviewHint", "Browse health, SSH and node details"),
		create: tabLabel(t, "serversPage.tabs.addVpsHint", "Register a new VPS profile"),
		sshkeys: tabLabel(t, "serversPage.tabs.addKeyHint", "Manage reusable SSH keys"),
		batch: tabLabel(t, "serversPage.tabs.batchHint", "Run bulk enable / disable actions"),
	};

	return (
		<div className="space-y-5">
			<section
				aria-label={t("serversPage.quickActionsAria")}
				className="rounded-2xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_90%,transparent)] p-2 shadow-[var(--shadow-sm)]"
			>
				<div role="tablist" aria-label={t("serversPage.quickActionsAria")} className="grid gap-2 md:grid-cols-4">
					{actions.map((action) => {
						const disabled = !panels[action.key];
						const active = activePanel === action.key;
						return (
							<button
								key={action.key}
								type="button"
								role="tab"
								aria-label={t(action.labelKey)}
								aria-selected={active}
								aria-pressed={active}
								onClick={() => !disabled && setActivePanel(action.key)}
								disabled={disabled}
								className={`group rounded-xl border px-3.5 py-3 text-left transition ${
									active
										? "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--text-primary)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_25%,transparent)]"
										: "border-transparent bg-transparent text-[var(--text-secondary)] hover:border-[var(--border)] hover:bg-[var(--surface-elevated)]"
								} ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
							>
								<div className="flex items-start gap-2.5">
									<span
										className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
											active
												? "border-[var(--accent-border)] bg-[var(--surface)] text-[var(--accent)]"
												: "border-[var(--border-subtle)] bg-[var(--surface)] text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]"
										}`}
									>
										{action.icon}
									</span>
									<span className="min-w-0">
										<span className="block text-sm font-semibold">{t(action.labelKey)}</span>
										<span className={`mt-0.5 block text-[11px] leading-4 ${active ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"}`} aria-hidden="true">
											{hints[action.key]}
										</span>
									</span>
								</div>
							</button>
						);
					})}
				</div>
			</section>

			<div role="tabpanel" className="min-h-[12rem]">
				{panels[activePanel]}
			</div>
		</div>
	);
}
