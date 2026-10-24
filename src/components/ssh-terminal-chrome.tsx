"use client";

import { UI_INPUT } from "@/lib/ui/classes";
import { isImeComposition } from "@/lib/ui/keyboard";
import { cn } from "@/lib/ui/cn";
import type { ReactNode } from "react";

import type { TerminalStatus } from "@/components/ssh-terminal-types";
import { ActionButton } from "@/components/action-button";
import { ClipboardList, Folder, Hand, Keyboard, Languages, Maximize2, Minimize2, Monitor, MousePointer, Server, X } from "@/components/icons";
import { StatusBadge, type StatusTone } from "@/components/status-badge";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

const chipBase = "min-h-9 rounded-full border px-3 py-1 text-xs transition";
const chipIdle = "border-[var(--border-subtle)] light:border-[var(--border)] bg-[var(--surface-subtle)] light:bg-[var(--surface)] text-[var(--text-secondary)] light:text-[var(--text-muted)] hover:bg-[var(--surface-elevated)] light:hover:bg-[var(--surface-hover)]/50";
const chipActive = "border-[var(--color-action-border)] bg-[var(--color-action-bg)] text-[var(--color-action-text)]";
/** Chip whose icon stands alone (phones, the full-screen strip): a square touch target. */
const chipIcon = "inline-flex min-h-9 min-w-9 items-center justify-center";

/** Status badge tone and label shared by the SSH and remote desktop toolbars. */
function sessionStatus(status: TerminalStatus, t: TFn): { tone: StatusTone; label: string } {
	return {
		tone: status === "connected" ? "success" : status === "connecting" ? "warning" : "danger",
		label: status === "connected"
			? t("sshTerminalModal.statusConnected")
			: status === "connecting"
				? t("sshTerminalModal.statusConnecting")
				: status === "error"
					? t("sshTerminalModal.statusError")
					: t("sshTerminalModal.statusClosed"),
	};
}

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
	const { tone: statusTone, label: statusLabel } = sessionStatus(status, t);
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

export type RemoteDesktopTouchMode = "touchpad" | "touch";
/** Remote: keys go to Windows and its input method composes. Local: the browser's input method composes and the text is sent. */
export type RemoteDesktopInputMethod = "remote" | "local";

/**
 * The remote desktop's bar, built like the SSH one: name and host, status,
 * then chips. On touch screens it adds the two things a phone needs and a
 * desktop does not — the on-screen keyboard and the pointer mode (a touchpad
 * with a visible pointer, as in Microsoft's Remote Desktop app, or direct touch).
 */
export function RemoteDesktopToolbar({
	serverName,
	host,
	status,
	t,
	fullscreen = false,
	touch,
	touchMode,
	inputMethod,
	viewMode,
	elapsed,
	onToggleTouchMode,
	onKeyboard,
	onToggleInputMethod,
	onToggleView,
	onCtrlAltDel,
	onToggleFullscreen,
	onReconnect,
	onClose,
}: {
	serverName: string;
	host: string;
	status: TerminalStatus;
	t: TFn;
	fullscreen?: boolean;
	/** A touch screen: show the keyboard and pointer-mode chips. */
	touch: boolean;
	touchMode: RemoteDesktopTouchMode;
	/** Which input method composes Chinese and other text (mouse and keyboard devices). */
	inputMethod: RemoteDesktopInputMethod;
	viewMode: "fit" | "actual";
	/** Connected time, e.g. "03:12"; null while not connected. */
	elapsed: string | null;
	onToggleTouchMode: () => void;
	onKeyboard: () => void;
	onToggleInputMethod: () => void;
	onToggleView: () => void;
	onCtrlAltDel: () => void;
	onToggleFullscreen?: () => void;
	onReconnect: () => void;
	onClose: () => void;
}) {
	const { tone: statusTone, label: statusLabel } = sessionStatus(status, t);
	const connected = status === "connected";
	const pointerLabel = t(touchMode === "touchpad" ? "rdp.pointer.touchpad" : "rdp.pointer.touch");
	const reconnectButton = (status === "error" || status === "closed") && (
		<ActionButton size="sm" variant="outline" onClick={onReconnect} data-tone="cyan">
			{t("sshTerminalModal.reconnect")}
		</ActionButton>
	);
	// Phones: icon-only chips, so the bar stays one row and the desktop keeps its height.
	const chip = (label: string, icon: ReactNode, onClick: () => void, extra?: { pressed?: boolean; disabled?: boolean; testId?: string; iconOnly?: boolean; title?: string }) => (
		<button
			type="button"
			onClick={onClick}
			disabled={extra?.disabled}
			aria-pressed={extra?.pressed}
			aria-label={label}
			title={extra?.title ?? label}
			data-testid={extra?.testId}
			className={cn(chipBase, chipIcon, !extra?.iconOnly && "sm:min-w-0", extra?.pressed ? chipActive : chipIdle, "disabled:opacity-50")}
		>
			{icon}
			{!extra?.iconOnly && <span className="hidden sm:ml-1 sm:inline">{label}</span>}
		</button>
	);
	// A touch screen types with its own on-screen keyboard: always the local input method.
	const inputMethodChip = !touch && chip(
		t(inputMethod === "remote" ? "rdp.inputMethod.remote" : "rdp.inputMethod.local"),
		<Languages size={14} aria-hidden="true" />,
		onToggleInputMethod,
		{ testId: "rdp-input-method", iconOnly: fullscreen, title: t(inputMethod === "remote" ? "rdp.inputMethod.remoteHint" : "rdp.inputMethod.localHint") },
	);
	const touchChips = touch && (
		<>
			{chip(t("rdp.keyboard"), <Keyboard size={14} aria-hidden="true" />, onKeyboard, { disabled: !connected, iconOnly: fullscreen, testId: "rdp-keyboard" })}
			{chip(pointerLabel, touchMode === "touchpad" ? <MousePointer size={14} aria-hidden="true" /> : <Hand size={14} aria-hidden="true" />, onToggleTouchMode, { iconOnly: fullscreen, testId: "rdp-pointer-mode" })}
		</>
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
					{touchChips}
					{inputMethodChip}
					{chip("Ctrl+Alt+Del", <span className="text-[10px] font-semibold">CAD</span>, onCtrlAltDel, { disabled: !connected, iconOnly: true })}
					<button
						type="button"
						onClick={onToggleFullscreen}
						aria-label={t("sshTerminalModal.fullscreenExit")}
						title={t("sshTerminalModal.fullscreenExit")}
						className={cn(chipBase, chipIcon, chipIdle)}
						data-testid="rdp-fullscreen-exit"
					>
						<Minimize2 size={14} aria-hidden="true" />
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] light:border-[var(--border)] px-4 py-2">
			<div className="flex min-w-0 items-center gap-2">
				<Monitor size={15} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
				<span className="truncate text-sm font-medium text-[var(--text-primary)]">{serverName}</span>
				<span className="truncate text-xs text-[var(--text-secondary)]">{host}</span>
			</div>
			<div className="ml-auto flex flex-wrap items-center gap-2">
				<StatusBadge tone={statusTone} size="md" role="status" aria-live="polite">
					{statusLabel}
				</StatusBadge>
				{elapsed && <span className="hidden text-xs tabular-nums text-[var(--text-muted)] sm:inline" title={t("rdp.elapsed", { time: elapsed })}>{elapsed}</span>}
				{touchChips}
				{inputMethodChip}
				{chip("Ctrl+Alt+Del", <span className="text-[10px] font-semibold sm:hidden">CAD</span>, onCtrlAltDel, { disabled: !connected })}
				{/* A phone fits the desktop to the screen; actual size cannot be panned by touch. */}
				{!touch && chip(t(viewMode === "fit" ? "rdp.view.actual" : "rdp.view.fit"), <span className="text-[10px] font-semibold sm:hidden">1:1</span>, onToggleView, { pressed: viewMode === "actual", disabled: !connected })}
				{onToggleFullscreen && (
					<button
						type="button"
						onClick={onToggleFullscreen}
						aria-label={t("sshTerminalModal.fullscreen")}
						title={t("sshTerminalModal.fullscreen")}
						className={cn(chipBase, chipIcon, "sm:min-w-0", chipIdle)}
						data-testid="rdp-fullscreen-enter"
					>
						<Maximize2 size={14} className="sm:mr-1" aria-hidden="true" />
						<span className="hidden sm:inline">{t("sshTerminalModal.fullscreen")}</span>
					</button>
				)}
				{reconnectButton}
				<button
					type="button"
					onClick={onClose}
					aria-label={t("rdp.closeAria")}
					title={t("rdp.closeAria")}
					className={cn(chipBase, chipIcon, "sm:min-w-0", chipIdle)}
				>
					<X size={14} className="sm:hidden" aria-hidden="true" />
					<span className="hidden sm:inline">{t("sshTerminalModal.close")}</span>
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
		// One row on phones too: the input flexes and the buttons shrink to
		// symbols, so the search bar does not take terminal rows away.
		<div data-inset className="flex items-center gap-2 light:border-[var(--border)] light:bg-[var(--surface)] p-2">
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
					UI_INPUT,"min-h-10 min-w-0 flex-1 placeholder:text-[var(--text-muted)]/20 sm:min-w-[180px]",
				)}
			/>
			<ActionButton variant="outline"
				onClick={() => onSearch("previous")}
				aria-label={t("sshTerminalModal.searchPrevious")}
				data-tone="cyan"
				className="shrink-0 max-sm:!min-w-11 max-sm:!px-0"
			>
				<span aria-hidden="true" className="sm:hidden">↑</span>
				<span className="max-sm:hidden">{t("sshTerminalModal.searchPrevious")}</span>
			</ActionButton>
			<ActionButton variant="outline"
				onClick={() => onSearch("next")}
				aria-label={t("sshTerminalModal.searchNext")}
				data-tone="cyan"
				className="shrink-0 max-sm:!min-w-11 max-sm:!px-0">
				<span aria-hidden="true" className="sm:hidden">↓</span>
				<span className="max-sm:hidden">{t("sshTerminalModal.searchNext")}</span>
			</ActionButton>
			<ActionButton variant="secondary"
				onClick={onClear}
				aria-label={t("sshTerminalModal.searchClear")}
				className="shrink-0 max-sm:!min-w-11 max-sm:!px-0">
				<span aria-hidden="true" className="sm:hidden">✕</span>
				<span className="max-sm:hidden">{t("sshTerminalModal.searchClear")}</span>
			</ActionButton>
		</div>
	);
}
