"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { SshTerminalPanel, type TerminalStatus } from "@/components/ssh-terminal-panel";

/* ------------------------------------------------------------------ */
/* SshTerminalManager — multi-tab SSH terminal floating workbench     */
/*                                                                    */
/* Key design decisions (TR-042 follow-up):                            */
/* - NOT a modal dialog: no focus trap, no backdrop, no Escape=close  */
/* - Minimizable: collapses to a small pill at bottom-right           */
/* - Non-blocking: pointer-events-none on wrapper, page stays alive   */
/* - Escape closes the active tab (not all tabs)                      */
/* - All terminal WebSockets stay alive even when minimized          */
/* ------------------------------------------------------------------ */

export type SshTerminalTab = {
	id: string; // `${serverId}-${nonce}` to allow re-opening same server
	serverId: string;
	serverName: string;
	host: string;
	sessionToken: string;
	status: TerminalStatus;
};

export type SshTerminalManagerProps = {
	/** Currently open tabs. The manager is rendered when tabs.length > 0. */
	tabs: SshTerminalTab[];
	/** Index of the active tab. */
	activeTabIndex: number;
	/** Called when the user clicks a tab. */
	onTabSelect: (index: number) => void;
	/** Called when the user closes a tab. */
	onTabClose: (index: number) => void;
	/** Called when the manager is closed (close button). */
	onClose: () => void;
	/** Called when a tab's status changes (for parent state sync). */
	onStatusChange: (index: number, status: TerminalStatus) => void;
};

export function SshTerminalManager({
	tabs,
	activeTabIndex,
	onTabSelect,
	onTabClose,
	onClose,
	onStatusChange,
}: SshTerminalManagerProps) {
	const { t } = useI18n();
	const [minimized, setMinimized] = useState(false);

	// ── Keyboard shortcuts ──────────────────────────────────────
	// Escape → close active tab (NOT all tabs)
	// Ctrl/Cmd+Tab → cycle tabs
	// Ctrl/Cmd+M → toggle minimize
	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			// Ctrl/Cmd+Tab to cycle tabs
			if ((e.ctrlKey || e.metaKey) && e.key === "Tab") {
				e.preventDefault();
				const next = e.shiftKey
					? (activeTabIndex - 1 + tabs.length) % tabs.length
					: (activeTabIndex + 1) % tabs.length;
				onTabSelect(next);
				return;
			}

			// Ctrl/Cmd+M to toggle minimize
			if ((e.ctrlKey || e.metaKey) && e.key === "m") {
				e.preventDefault();
				setMinimized((m) => !m);
				return;
			}

			// Escape: close active tab only if expanded
			if (e.key === "Escape" && !minimized) {
				e.preventDefault();
				if (tabs.length > 0) {
					onTabClose(activeTabIndex);
				}
			}
		},
		[activeTabIndex, tabs.length, onTabSelect, onTabClose, minimized],
	);

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleKeyDown]);

	if (tabs.length === 0) return null;
	const connectedCount = tabs.filter((tab) => tab.status === "connected").length;

	// ── Minimized: small floating pill at bottom-right ──────────
	if (minimized) {
		return (
			<div className="pointer-events-none fixed inset-x-2 bottom-2 z-50 flex justify-end sm:inset-x-4 sm:bottom-4">
				<button
					type="button"
					onClick={() => setMinimized(false)}
					className="pointer-events-auto flex items-center gap-2 rounded-full border border-[var(--border-subtle)] light:border-slate-200 bg-[var(--surface)] px-4 py-2.5 text-xs text-[var(--text-primary)] light:text-slate-900 shadow-2xl transition hover:bg-[var(--surface-elevated)] light:hover:bg-slate-800"
					aria-label={t("sshTerminalManager.title")}
				>
					<span className="flex h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
					<span className="font-medium">
						{tabs.length} {t("sshTerminalManager.tabsSuffix")}
					</span>
					{connectedCount > 0 && (
						<span className="text-emerald-400">
							{connectedCount} ●
						</span>
					)}
					<span className="text-[var(--text-muted)]">⤢ {t("sshTerminalManager.expand")}</span>
				</button>
			</div>
		);
	}

	// ── Expanded: floating workbench panel at bottom-right ──────
	return (
		<div className="pointer-events-none fixed inset-x-2 bottom-2 z-50 flex justify-end sm:inset-x-4 sm:bottom-4">
			<div
				role="region"
				data-ssh-terminal-dialog="true"
				aria-labelledby="ssh-terminal-manager-title"
				style={{
					backgroundColor: "var(--surface)",
					borderColor: "var(--border)",
					color: "var(--text-primary)",
				}}
				className="pointer-events-auto flex max-h-[72vh] min-h-0 w-full max-w-5xl flex-col rounded-2xl border border-[var(--border-subtle)] light:border-slate-200 bg-[var(--surface)] text-[var(--text-primary)] light:text-slate-900 shadow-2xl sm:rounded-3xl"
			>
				{/* Title bar + tab bar + controls */}
				<div className="flex items-center justify-between border-b border-[var(--border-subtle)] light:border-slate-200 px-4 py-2.5">
					<div className="flex items-center gap-2">
						<h3 id="ssh-terminal-manager-title" className="text-sm font-semibold text-[var(--text-primary)] light:text-slate-900">
							{t("sshTerminalManager.title")}
						</h3>
						<span className="rounded-full bg-[var(--surface-subtle)] light:bg-slate-800 px-2 py-0.5 text-xs text-[var(--text-secondary)] light:text-slate-600">
							{tabs.length} {t("sshTerminalManager.tabsSuffix")}
						</span>
					</div>
					<div className="flex items-center gap-1">
						{/* Minimize button */}
						<button
							type="button"
							onClick={() => setMinimized(true)}
							aria-label={t("sshTerminalManager.minimize")}
							className="min-h-9 min-w-9 rounded-lg border border-[var(--border-subtle)] light:border-slate-200 bg-[var(--surface-subtle)] light:bg-slate-800/50 px-3 py-1.5 text-xs text-[var(--text-secondary)] light:text-slate-600 transition hover:bg-[var(--surface-elevated)] light:hover:bg-[var(--surface-hover)]/50"
							title={t("sshTerminalManager.minimize")}
						>
							▬
						</button>
						{/* Close all button */}
						<button
							type="button"
							onClick={onClose}
							aria-label={t("sshTerminalModal.ariaClose")}
							className="min-h-9 min-w-9 rounded-lg border border-[var(--border-subtle)] light:border-slate-200 bg-[var(--surface-subtle)] light:bg-slate-800/50 px-3 py-1.5 text-xs text-[var(--text-secondary)] light:text-slate-600 transition hover:bg-[var(--surface-elevated)] light:hover:bg-[var(--surface-hover)]/50"
							title={t("sshTerminalModal.close")}
						>
							✕
						</button>
					</div>
				</div>

				{/* Tab bar */}
				<div className="flex items-stretch gap-0.5 overflow-x-auto border-b border-[var(--border-subtle)] light:border-slate-200 bg-[var(--surface-subtle)] light:bg-slate-100 px-2 py-1" role="tablist">
					{tabs.map((tab, i) => {
						const isActive = i === activeTabIndex;
						const statusColor =
							tab.status === "connected"
								? "bg-emerald-400"
								: tab.status === "connecting"
									? "bg-amber-400"
									: "bg-rose-400";
						return (
							<div
								key={tab.id}
								role="tab"
								aria-selected={isActive}
								tabIndex={isActive ? 0 : -1}
								onClick={() => onTabSelect(i)}
								className={`group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs transition ${
									isActive
										? "bg-[var(--surface-elevated)] light:bg-[var(--surface-hover)] text-[var(--text-primary)] light:text-slate-900"
										: "text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] light:hover:bg-slate-600 hover:text-[var(--text-secondary)] light:hover:text-slate-700"
								}`}
							>
								<span className={`h-2 w-2 shrink-0 rounded-full ${statusColor}`} aria-hidden="true" />
								<span className="max-w-[160px] truncate font-medium">{tab.serverName}</span>
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										onTabClose(i);
									}}
									aria-label={t("sshTerminalManager.closeTab").replace("{serverName}", tab.serverName)}
									className="ml-1 shrink-0 rounded p-0.5 text-[var(--text-muted)] opacity-0 transition hover:bg-[var(--surface-elevated)] light:hover:bg-[var(--surface-hover)] hover:text-rose-300 group-hover:opacity-100"
								>
									✕
								</button>
							</div>
						);
					})}
				</div>

				{/* Terminal panels — all mounted, only active visible */}
				<div className="flex min-h-0 flex-1 flex-col">
					{tabs.map((tab, i) => (
						<SshTerminalPanel
							key={tab.id}
							serverId={tab.serverId}
							serverName={tab.serverName}
							host={tab.host}
							sessionToken={tab.sessionToken}
							visible={i === activeTabIndex}
							onClose={() => onTabClose(i)}
							onStatusChange={(status) => onStatusChange(i, status)}
						/>
					))}
				</div>
			</div>
		</div>
	);
}