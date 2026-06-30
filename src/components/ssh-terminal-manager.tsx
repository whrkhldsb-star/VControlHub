"use client";

import { useCallback, useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";
import { SshTerminalPanel, type TerminalStatus } from "@/components/ssh-terminal-panel";

/* ------------------------------------------------------------------ */
/* SshTerminalManager — multi-tab SSH terminal modal                  */
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
	/** Called when the manager modal is closed (close button or backdrop). */
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
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const dialogRef = useDialogFocus<HTMLDivElement>({
		open: true,
		onClose,
		initialFocusRef: closeButtonRef,
	});

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			// Ctrl/Cmd+Tab to cycle tabs
			if ((e.ctrlKey || e.metaKey) && e.key === "Tab") {
				e.preventDefault();
				const next = e.shiftKey
					? (activeTabIndex - 1 + tabs.length) % tabs.length
					: (activeTabIndex + 1) % tabs.length;
				onTabSelect(next);
			}
		},
		[activeTabIndex, tabs.length, onTabSelect],
	);

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleKeyDown]);

	if (tabs.length === 0) return null;

	return (
		<div className="pointer-events-none fixed inset-x-2 bottom-2 z-50 flex justify-end sm:inset-x-4 sm:bottom-4">
			<div
				ref={dialogRef}
				role="region"
				data-ssh-terminal-dialog="true"
				aria-labelledby="ssh-terminal-manager-title"
				style={{
					backgroundColor: "var(--surface)",
					borderColor: "var(--border)",
					color: "var(--text-primary)",
				}}
				className="pointer-events-auto flex max-h-[78vh] min-h-0 w-full max-w-5xl flex-col rounded-2xl border border-white/10 bg-slate-900 text-white shadow-2xl sm:max-h-[82vh] sm:rounded-3xl"
			>
				{/* Title bar + tab bar */}
				<div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
					<div className="flex items-center gap-2">
						<h3 id="ssh-terminal-manager-title" className="text-sm font-semibold text-white">
							{t("sshTerminalManager.title")}
						</h3>
						<span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-300">
							{tabs.length} {t("sshTerminalManager.tabsSuffix")}
						</span>
					</div>
					<button
						ref={closeButtonRef}
						type="button"
						onClick={onClose}
						aria-label={t("sshTerminalModal.ariaClose")}
						className="min-h-11 min-w-11 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-slate-300 transition hover:bg-white/10"
					>
						{t("sshTerminalModal.close")}
					</button>
				</div>

				{/* Tab bar */}
				<div className="flex items-stretch gap-0.5 overflow-x-auto border-b border-white/10 bg-black/20 px-2 py-1" role="tablist">
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
										? "bg-white/10 text-white"
										: "text-slate-400 hover:bg-white/5 hover:text-slate-200"
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
									className="ml-1 shrink-0 rounded p-0.5 text-slate-500 opacity-0 transition hover:bg-white/10 hover:text-rose-300 group-hover:opacity-100"
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
