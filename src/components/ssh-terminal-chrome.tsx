"use client";

import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";

import type { TerminalStatus } from "@/components/ssh-terminal-types";

type TFn = (key: string) => string;

const chipBase =
	"min-h-9 rounded-full border px-3 py-1 text-xs transition";
const chipIdle =
	"border-[var(--border-subtle)] light:border-[var(--border)] bg-[var(--surface-subtle)] light:bg-[var(--surface)] text-[var(--text-secondary)] light:text-[var(--text-muted)] hover:bg-[var(--surface-elevated)] light:hover:bg-[var(--surface-hover)]/50";
const chipActive =
	"border-[var(--color-action-border)]/30 bg-[var(--color-action-bg)]/10 text-[var(--color-action-fg)]";

export function SshTerminalToolbar({
	serverName,
	host,
	status,
	t,
	showSidePanel,
	showFileManager,
	onToggleSidePanel,
	onToggleFileManager,
	onReconnect,
	onClose,
}: {
	serverName: string;
	host: string;
	status: TerminalStatus;
	t: TFn;
	showSidePanel: boolean;
	showFileManager: boolean;
	onToggleSidePanel: () => void;
	onToggleFileManager: () => void;
	onReconnect: () => void;
	onClose: () => void;
}) {
	const statusClass =
		status === "connected"
			? "border border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]"
			: status === "connecting"
				? "border border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]"
				: "border border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]";
	const statusLabel =
		status === "connected"
			? t("sshTerminalModal.statusConnected")
			: status === "connecting"
				? t("sshTerminalModal.statusConnecting")
				: status === "error"
					? t("sshTerminalModal.statusError")
					: t("sshTerminalModal.statusClosed");

	return (
		<div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] light:border-[var(--border)] px-4 py-2">
			<div className="flex items-center gap-2">
				<span className="text-sm" aria-hidden="true">
					💻
				</span>
				<span className="text-sm font-medium text-[var(--text-primary)] light:text-[var(--text-disabled)]">
					{serverName}
				</span>
				<span className="text-xs text-[var(--text-secondary)]">{host}</span>
			</div>
			<div className="ml-auto flex flex-wrap items-center gap-2">
				<span role="status" aria-live="polite" className={`rounded-full px-3 py-1 text-xs ${statusClass}`}>
					{statusLabel}
				</span>
				<button
					type="button"
					onClick={onToggleSidePanel}
					aria-expanded={showSidePanel}
					className={`${chipBase} ${showSidePanel ? chipActive : chipIdle}`}
				>
					{t("sshTerminalModal.panelToggle")}
				</button>
				<button
					type="button"
					onClick={onToggleFileManager}
					aria-expanded={showFileManager}
					className={`${chipBase} ${showFileManager ? chipActive : chipIdle}`}
				>
					{t("sshFileManager.toggle")}
				</button>
				{(status === "error" || status === "closed") && (
					<button
						type="button"
						onClick={onReconnect}
						data-tone="cyan"
						className="min-h-9 rounded-full border border-[var(--color-action-border)]/30 px-3 py-1 text-xs text-[var(--color-action-fg)] transition hover:bg-[var(--color-action-bg)]/20"
					>
						{t("sshTerminalModal.reconnect")}
					</button>
				)}
				<button
					type="button"
					onClick={onClose}
					aria-label={t("sshTerminalModal.ariaClose")}
					className={`${chipBase} ${chipIdle}`}
				>
					{t("sshTerminalModal.close")}
				</button>
			</div>
		</div>
	);
}

export function SshTerminalSearchBar({
	serverId,
	t,
	terminalSearch,
	onSearchChange,
	onSearch,
	onClear,
}: {
	serverId: string;
	t: TFn;
	terminalSearch: string;
	onSearchChange: (value: string) => void;
	onSearch: (direction: "next" | "previous") => void;
	onClear: () => void;
}) {
	return (
		<div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-subtle)] light:border-[var(--border)] bg-[var(--surface-subtle)] light:bg-[var(--surface)] p-2">
			<label htmlFor={`ssh-terminal-search-${serverId}`} className="sr-only">
				{t("sshTerminalModal.searchLabel")}
			</label>
			<input
				id={`ssh-terminal-search-${serverId}`}
				value={terminalSearch}
				onChange={(e) => onSearchChange(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") onSearch(e.shiftKey ? "previous" : "next");
					if (e.key === "Escape") onClear();
				}}
				placeholder={t("sshTerminalModal.searchPlaceholder")}
				className={cn(
					UI_INPUT,
					"min-h-10 min-w-[180px] flex-1 light:text-[var(--text-disabled)] placeholder:text-[var(--text-muted)]/20",
				)}
			/>
			<button
				type="button"
				onClick={() => onSearch("previous")}
				className="min-h-10 rounded-xl border border-[var(--border-subtle)] light:border-[var(--border)] px-3 text-xs text-[var(--text-secondary)] light:text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] light:hover:bg-[var(--surface)]"
			>
				{t("sshTerminalModal.searchPrevious")}
			</button>
			<button
				type="button"
				onClick={() => onSearch("next")}
				data-tone="cyan"
				className="min-h-10 rounded-xl border border-[var(--color-action-border)]/20 px-3 text-xs text-[var(--color-action-fg)] hover:bg-[var(--color-action-bg)]/20"
			>
				{t("sshTerminalModal.searchNext")}
			</button>
			<button
				type="button"
				onClick={onClear}
				className="min-h-10 rounded-xl border border-[var(--border-subtle)] light:border-[var(--border)] px-3 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] light:hover:bg-[var(--surface)]"
			>
				{t("sshTerminalModal.searchClear")}
			</button>
		</div>
	);
}
