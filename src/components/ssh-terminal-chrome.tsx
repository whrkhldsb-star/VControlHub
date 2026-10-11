"use client";

import { UI_INPUT } from "@/lib/ui/classes";
import { isImeComposition } from "@/lib/ui/keyboard";
import { cn } from "@/lib/ui/cn";

import type { TerminalStatus } from "@/components/ssh-terminal-types";
import { ActionButton } from "@/components/action-button";
import { ClipboardList, Folder, Maximize2, Minimize2, Server } from "@/components/icons";
import { StatusBadge, type StatusTone } from "@/components/status-badge";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

const chipBase = "min-h-9 rounded-full border px-3 py-1 text-xs transition";
const chipIdle = "border-[var(--border-subtle)] light:border-[var(--border)] bg-[var(--surface-subtle)] light:bg-[var(--surface)] text-[var(--text-secondary)] light:text-[var(--text-muted)] hover:bg-[var(--surface-elevated)] light:hover:bg-[var(--surface-hover)]/50";
const chipActive = "border-[var(--color-action-border)] bg-[var(--color-action-bg)] text-[var(--color-action-text)]";
/** Chip whose icon stands alone (phones, the full-screen strip): a square touch target. */
const chipIcon = "inline-flex min-h-9 min-w-9 items-center justify-center";

export function SshTerminalToolbar({
	serverName,
	host,
	status,
	t,
	showSidePanel,
	showFileManager,
	fullscreen = false,
	onToggleSidePanel,
	onToggleFileManager,
	onToggleFullscreen,
	onReconnect,
	onClose,
}: {
	serverName: string;
	host: string;
	status: TerminalStatus;
	t: TFn;
	showSidePanel: boolean;
	showFileManager: boolean;
	/** Full screen: the whole viewport is the terminal, so the bar shrinks to a strip. */
	fullscreen?: boolean;
	onToggleSidePanel: () => void;
	onToggleFileManager: () => void;
	/** Absent when the host cannot go full screen (no toggle is shown). */
	onToggleFullscreen?: () => void;
	onReconnect: () => void;
	onClose: () => void;
}) {
	const statusTone: StatusTone =
		status === "connected"
			? "success"
			: status === "connecting"
				? "warning"
				: "danger";
	const statusLabel =
		status === "connected"
			? t("sshTerminalModal.statusConnected")
			: status === "connecting"
				? t("sshTerminalModal.statusConnecting")
				: status === "error"
					? t("sshTerminalModal.statusError")
					: t("sshTerminalModal.statusClosed");
	const reconnectButton = (status === "error" || status === "closed") && (
		<ActionButton size="sm" variant="outline" onClick={onReconnect} data-tone="cyan">
			{t("sshTerminalModal.reconnect")}
		</ActionButton>
	);

	if (fullscreen) {
		return (
			<div className="flex items-center gap-2 border-b border-[var(--border-subtle)] light:border-[var(--border)] px-2 py-1">
				<StatusBadge tone={statusTone} size="sm" role="status" aria-live="polite">
					{statusLabel}
				</StatusBadge>
				<span className="min-w-0 truncate text-xs font-medium text-[var(--text-primary)]">{serverName}</span>
				<div className="ml-auto flex shrink-0 items-center gap-1">
					{reconnectButton}
					<button
						type="button"
						onClick={onToggleSidePanel}
						aria-expanded={showSidePanel}
						aria-label={t("sshTerminalModal.panelToggle")}
						title={t("sshTerminalModal.panelToggle")}
						className={cn(chipBase, chipIcon, showSidePanel ? chipActive : chipIdle)}
					>
						<ClipboardList size={14} aria-hidden="true" />
					</button>
					<button
						type="button"
						onClick={onToggleFullscreen}
						aria-label={t("sshTerminalModal.fullscreenExit")}
						title={t("sshTerminalModal.fullscreenExit")}
						className={cn(chipBase, chipIcon, chipIdle)}
						data-testid="ssh-terminal-fullscreen-exit"
					>
						<Minimize2 size={14} aria-hidden="true" />
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] light:border-[var(--border)] px-4 py-2">
			<div className="flex items-center gap-2">
				<Server size={15} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
				<span className="text-sm font-medium text-[var(--text-primary)]">
					{serverName}
				</span>
				<span className="text-xs text-[var(--text-secondary)]">{host}</span>
			</div>
			<div className="ml-auto flex flex-wrap items-center gap-2">
				<StatusBadge tone={statusTone} size="md" role="status" aria-live="polite">
					{statusLabel}
				</StatusBadge>
				{/* Phones get icon-only chips so the row stays one line and the terminal keeps its height. */}
				<button
					type="button"
					onClick={onToggleSidePanel}
					aria-expanded={showSidePanel}
					aria-label={t("sshTerminalModal.panelToggle")}
					title={t("sshTerminalModal.panelToggle")}
					className={cn(chipBase, chipIcon, "sm:min-w-0", showSidePanel ? chipActive : chipIdle)}
				>
					<ClipboardList size={14} className="sm:mr-1" aria-hidden="true" />
					<span className="hidden sm:inline">{t("sshTerminalModal.panelToggle")}</span>
				</button>
				<button
					type="button"
					onClick={onToggleFileManager}
					aria-expanded={showFileManager}
					aria-label={t("sshFileManager.toggle")}
					title={t("sshFileManager.toggle")}
					className={cn(chipBase, chipIcon, "sm:min-w-0", showFileManager ? chipActive : chipIdle)}
				>
					<Folder size={14} className="sm:mr-1" aria-hidden="true" />
					<span className="hidden sm:inline">{t("sshFileManager.toggle")}</span>
				</button>
				{onToggleFullscreen && (
					<button
						type="button"
						onClick={onToggleFullscreen}
						aria-label={t("sshTerminalModal.fullscreen")}
						title={t("sshTerminalModal.fullscreen")}
						className={cn(chipBase, chipIcon, "sm:min-w-0", chipIdle)}
						data-testid="ssh-terminal-fullscreen-enter"
					>
						<Maximize2 size={14} className="sm:mr-1" aria-hidden="true" />
						<span className="hidden sm:inline">{t("sshTerminalModal.fullscreen")}</span>
					</button>
				)}
				{reconnectButton}
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
		<div data-inset className="flex flex-wrap items-center gap-2 light:border-[var(--border)] light:bg-[var(--surface)] p-2">
			<label htmlFor={`ssh-terminal-search-${serverId}`} className="sr-only">
				{t("sshTerminalModal.searchLabel")}
			</label>
			<input
				id={`ssh-terminal-search-${serverId}`}
				value={terminalSearch}
				onChange={(e) => onSearchChange(e.target.value)}
				onKeyDown={(e) => {
					if (isImeComposition(e)) return;
					if (e.key === "Enter") {
						e.preventDefault();
						onSearch(e.shiftKey ? "previous" : "next");
					}
					if (e.key === "Escape") {
						e.preventDefault();
						e.stopPropagation();
						onClear();
					}
				}}
				placeholder={t("sshTerminalModal.searchPlaceholder")}
				className={cn(
					UI_INPUT,"min-h-10 min-w-[180px] flex-1 placeholder:text-[var(--text-muted)]/20",
				)}
			/>
			<ActionButton variant="outline"
				onClick={() => onSearch("previous")}
				data-tone="cyan"
			>
				{t("sshTerminalModal.searchPrevious")}
			</ActionButton>
			<ActionButton variant="outline"
				onClick={() => onSearch("next")}
				data-tone="cyan">
				{t("sshTerminalModal.searchNext")}
			</ActionButton>
			<ActionButton variant="secondary"
				onClick={onClear}>
				{t("sshTerminalModal.searchClear")}
			</ActionButton>
		</div>
	);
}
