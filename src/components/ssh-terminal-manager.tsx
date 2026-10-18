"use client";

import { X } from "@/components/icons";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/ui/cn";
import { SshTerminalPanel, type SshTerminalPanelHandle, type TerminalStatus } from "@/components/ssh-terminal-panel";
import { RemoteDesktopPanel, type RemoteDesktopPanelHandle } from "@/components/remote-desktop-panel";
import { useVisualViewportBox } from "@/components/ssh-terminal-viewport";
import { ActionButton } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { SshTerminalOperatingSystem } from "@/components/ssh-terminal-types";

/* ------------------------------------------------------------------ */
/* SshTerminalManager — multi-tab SSH terminal floating workbench     */
/*                                                                    */
/* Key design decisions:                                               */
/* - NOT a modal dialog: no focus trap, no backdrop                    */
/* - Minimizable: collapses to a small pill at bottom-right            */
/* - CRITICAL: minimize must NOT unmount SshTerminalPanel — that would */
/*   dispose xterm + close WebSockets. Keep panels mounted; only hide  */
/*   the expanded chrome with CSS when minimized.                      */
/* - Escape closes the active tab (not all tabs) when expanded         */
/* - Full screen: the active terminal takes the whole viewport (title,  */
/*   tab bar and search bar hidden) and the browser's own full screen   */
/*   is requested where it exists; on a phone the box follows the       */
/*   visual viewport so the on-screen keyboard never covers the prompt  */
/* ------------------------------------------------------------------ */

export type SshTerminalTab = {
	id: string; // `${serverId}-${nonce}` to allow re-opening same server
	/** An SSH terminal (default) or a Windows remote desktop; both live in this workbench. */
	kind?: "ssh" | "rdp";
	serverId: string;
	serverName: string;
	host: string;
	operatingSystem?: SshTerminalOperatingSystem;
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
	/**
	 * Called when a tab's status changes (for parent state sync). Keyed by the
	 * stable tab id so a status arriving after a tab shift cannot land on the
	 * wrong tab.
	 */
	onStatusChange: (tabId: string, status: TerminalStatus) => void;
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
	const [confirmCloseAll, setConfirmCloseAll] = useState(false);
	// Closing a tab or the manager on purpose ends those shells; an unmount for
	// any other reason (navigation, reload) leaves them resumable.
	const panelHandles = useRef(new Map<string, SshTerminalPanelHandle | RemoteDesktopPanelHandle>());
	const closeTab = useCallback((index: number) => {
		const tab = tabs[index];
		if (tab) panelHandles.current.get(tab.id)?.endSession();
		onTabClose(index);
	}, [tabs, onTabClose]);
	const closeAll = useCallback(() => {
		for (const tab of tabs) panelHandles.current.get(tab.id)?.endSession();
		onClose();
	}, [tabs, onClose]);
	const [mobileHeight, setMobileHeight] = useState<number | null>(null);
	const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
	const [fullscreen, setFullscreen] = useState(false);
	// Whether the browser granted its own full screen for our mode; iOS Safari
	// has no Fullscreen API for a page, so the mode then lives in CSS alone.
	const browserFullscreenRef = useRef(false);
	const viewportBox = useVisualViewportBox();

	const exitFullscreen = useCallback(() => {
		setFullscreen(false);
		if (browserFullscreenRef.current && document.fullscreenElement) {
			document.exitFullscreen().catch(() => {});
		}
		browserFullscreenRef.current = false;
	}, []);

	const enterFullscreen = useCallback(() => {
		setFullscreen(true);
		const root = document.documentElement;
		if (document.fullscreenElement || typeof root.requestFullscreen !== "function") return;
		root.requestFullscreen().then(
			() => { browserFullscreenRef.current = true; },
			() => {},
		);
	}, []);

	const toggleFullscreen = useCallback(() => {
		if (fullscreen) exitFullscreen();
		else enterFullscreen();
	}, [fullscreen, enterFullscreen, exitFullscreen]);

	// Leaving the browser's full screen (Esc, the back gesture) leaves ours too.
	useEffect(() => {
		const handleFullscreenChange = () => {
			if (document.fullscreenElement || !browserFullscreenRef.current) return;
			browserFullscreenRef.current = false;
			setFullscreen(false);
		};
		document.addEventListener("fullscreenchange", handleFullscreenChange);
		return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
	}, []);

	// The manager unmounts with its last tab; give the screen back then.
	useEffect(() => () => {
		if (browserFullscreenRef.current && document.fullscreenElement) {
			document.exitFullscreen().catch(() => {});
		}
	}, []);

	const handleMobileDragStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
		if (window.innerWidth >= 640) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		dragStateRef.current = {
			startY: event.clientY,
			startHeight: mobileHeight ?? window.innerHeight,
		};
	}, [mobileHeight]);

	const handleMobileDragMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
		const drag = dragStateRef.current;
		if (!drag) return;
		const viewportHeight = window.innerHeight;
		const nextHeight = Math.max(
			Math.min(viewportHeight, drag.startHeight + drag.startY - event.clientY),
			Math.min(360, viewportHeight),
		);
		setMobileHeight(nextHeight);
	}, []);

	const handleMobileDragEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
		dragStateRef.current = null;
		try {
			event.currentTarget.releasePointerCapture(event.pointerId);
		} catch {
			// Pointer capture may already have been released by the browser.
		}
	}, []);

	useEffect(() => {
		const handleViewportResize = () => {
			if (window.innerWidth >= 640) setMobileHeight(null);
		};
		window.addEventListener("resize", handleViewportResize);
		return () => window.removeEventListener("resize", handleViewportResize);
	}, []);

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

			// Escape: leave full screen, else close the active tab — only if
			// expanded AND the user is not typing into an editable field
			// (terminal xterm textarea, search boxes, etc.).
			if (e.key === "Escape" && !minimized) {
				const target = e.target;
				if (target instanceof HTMLElement) {
					const tag = target.tagName;
					const editable =
						target.isContentEditable ||
						tag === "INPUT" ||
						tag === "TEXTAREA" ||
						tag === "SELECT" ||
						target.closest(".xterm, .xterm-helper-textarea, [role='textbox'], [role='application']") !== null;
					if (editable) return;
				}
				e.preventDefault();
				if (fullscreen) {
					exitFullscreen();
					return;
				}
				if (tabs.length > 0) {
					closeTab(activeTabIndex);
				}
			}
		},
		[activeTabIndex, tabs.length, onTabSelect, closeTab, minimized, fullscreen, exitFullscreen],
	);

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleKeyDown]);

	if (tabs.length === 0) return null;
	const connectedCount = tabs.filter((tab) => tab.status === "connected").length;
	// Full screen sizes the box to the visible area: on a phone that is what
	// remains above the on-screen keyboard, and the box is moved down to where
	// the visual viewport sits when the browser has scrolled the page.
	const fullscreenStyle = fullscreen && viewportBox
		? {
			height: `${viewportBox.height}px`,
			transform: viewportBox.offsetTop > 0 ? `translateY(${viewportBox.offsetTop}px)` : undefined,
		}
		: { height: !fullscreen && mobileHeight ? `${mobileHeight}px` : undefined };

	return (
		<div
			className={cn(
				"pointer-events-none fixed inset-0 z-[var(--z-modal)] flex justify-end",
				// The minimized pill keeps its corner even while full screen is on.
				fullscreen && !minimized ? "items-start" : "items-end sm:inset-x-4 sm:inset-y-auto sm:bottom-4",
			)}
			data-fullscreen={fullscreen && !minimized ? "true" : undefined}
		>
			{/* Minimized pill — sessions stay mounted below, only chrome swaps */}
			{minimized && (
				<button
					type="button"
					onClick={() => setMinimized(false)}
					className="pointer-events-auto flex items-center gap-2 rounded-full border border-[var(--border-subtle)] light:border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs text-[var(--text-primary)] shadow-2xl transition hover:bg-[var(--surface-elevated)] light:hover:bg-[var(--surface-hover)]"
					aria-label={t("sshTerminalManager.title")}
					data-testid="ssh-terminal-minimized-pill"
				>
					<span className="flex h-2 w-2 rounded-full bg-[var(--success)]" aria-hidden />
					<span className="font-medium">
						{tabs.length} {t("sshTerminalManager.tabsSuffix")}
					</span>
					{connectedCount > 0 && (
						<span className="text-[var(--success)]">
							{connectedCount} ●
						</span>
					)}
					<span className="text-[var(--text-muted)]">⤢ {t("sshTerminalManager.expand")}</span>
				</button>
			)}

			{/* Expanded workbench — hidden via CSS when minimized so panels never unmount */}
			<div
				role="region"
				data-ssh-terminal-dialog="true"
				data-mobile-fullscreen="true"
				aria-labelledby="ssh-terminal-manager-title"
				aria-hidden={minimized}
				style={{
					backgroundColor: "var(--surface)",
					borderColor: "var(--border)",
					color: "var(--text-primary)",
					...fullscreenStyle,
					// Keep in DOM when minimized so WebSockets / xterm stay alive.
					// display:none is enough; panels already use display for tab visibility.
					display: minimized ? "none" : "flex",
				}}
				className={cn(
					"pointer-events-auto flex min-h-0 w-full flex-col overflow-hidden border border-[var(--border-subtle)] light:border-[var(--border)] bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-[var(--text-primary)] shadow-2xl",
					fullscreen
						? "h-[100dvh] max-h-none max-w-none rounded-none"
						// A definite height: the terminal fills what the chrome leaves
						// and is fitted to exactly that (an auto height clamped by a
						// max-height let the grid outgrow the visible box).
						: "h-[100dvh] max-h-[100dvh] max-w-5xl rounded-none sm:h-[72vh] sm:rounded-3xl sm:pt-0",
				)}
			>
				{!fullscreen && (
					<div
						className="flex h-6 shrink-0 touch-none select-none items-center justify-center sm:hidden"
						onPointerDown={handleMobileDragStart}
						onPointerMove={handleMobileDragMove}
						onPointerUp={handleMobileDragEnd}
						onPointerCancel={handleMobileDragEnd}
						role="separator"
						aria-orientation="horizontal"
						aria-label={t("sshTerminalManager.resizeHandle")}
						data-testid="ssh-terminal-mobile-resize-handle"
					>
						<span className="h-1 w-12 rounded-full bg-[var(--border-strong)]" aria-hidden="true" />
					</div>
				)}
				{/* Title bar + tab bar + controls; full screen keeps only the panel's strip */}
				{!fullscreen && (
					<div className="flex items-center justify-between border-b border-[var(--border-subtle)] light:border-[var(--border)] px-4 py-2.5">
						<div className="flex items-center gap-2">
							<h3 id="ssh-terminal-manager-title" className="ui-title-group">
								{t("sshTerminalManager.title")}
							</h3>
							<span className="rounded-full bg-[var(--surface-subtle)] light:bg-[var(--surface-hover)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
								{tabs.length} {t("sshTerminalManager.tabsSuffix")}
							</span>
						</div>
						<div className="flex items-center gap-1">
							<button
								type="button"
								onClick={() => setMinimized(true)}
								aria-label={t("sshTerminalManager.minimize")}
								className="min-h-9 min-w-9 rounded-lg border border-[var(--border-subtle)] light:border-[var(--border)] bg-[var(--surface-subtle)] light:bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-secondary)] light:text-[var(--text-muted)] transition hover:bg-[var(--surface-elevated)] light:hover:bg-[var(--surface-hover)]/50"
								title={t("sshTerminalManager.minimize")}
								data-testid="ssh-terminal-minimize"
							>
								▬
							</button>
							<ActionButton variant="secondary"
								onClick={() => {
									// The X kills every session at once — one misclick
									// (especially on mobile) must not drop every PTY.
									// Escape intentionally closes only the active tab.
									if (tabs.length > 1) setConfirmCloseAll(true);
									else closeAll();
								}}
								aria-label={t("sshTerminalModal.ariaClose")}
								title={t("sshTerminalModal.close")}
								size="sm"
								square
							>
								<X size={16} aria-hidden />
							</ActionButton>
						</div>
					</div>

				)}

				{/* Tab bar */}
				{!fullscreen && (
					<div
						className="flex items-stretch gap-0.5 overflow-x-auto border-b border-[var(--border-subtle)] light:border-[var(--border)] bg-[var(--surface-subtle)] light:bg-[var(--surface)] px-2 py-1"
						role="tablist"
					>
						{tabs.map((tab, i) => {
							const isActive = i === activeTabIndex;
							const statusColor =
								tab.status === "connected"
									? "bg-[var(--success)]"
									: tab.status === "connecting"
										? "bg-[var(--warning)]"
										: "bg-[var(--danger)]";
							return (
								<div
									key={tab.id}
									role="tab"
									aria-selected={isActive}
									tabIndex={isActive ? 0 : -1}
									onClick={() => onTabSelect(i)}
									onKeyDown={(e) => {
										// Only act when the tab itself has focus — the close
										// button inside handles its own activation.
										if (e.target !== e.currentTarget) return;
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											onTabSelect(i);
											return;
										}
										// Roving focus: arrows move between adjacent tabs.
										if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
											e.preventDefault();
											const tablist = e.currentTarget.parentElement;
											if (!tablist) return;
											const tabEls = Array.from(tablist.querySelectorAll<HTMLElement>('[role="tab"]'));
											const current = tabEls.indexOf(e.currentTarget);
											if (current === -1 || tabEls.length === 0) return;
											const delta = e.key === "ArrowRight" ? 1 : -1;
											tabEls[(current + delta + tabEls.length) % tabEls.length]?.focus();
										}
									}}
									className={`group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs transition ${
										isActive
											? "bg-[var(--surface-elevated)] light:bg-[var(--surface-hover)] text-[var(--text-primary)]"
											: "text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] light:hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]"
									}`}
								>
									<span className={`h-2 w-2 shrink-0 rounded-full ${statusColor}`} aria-hidden="true" />
									{tab.kind === "rdp" && <span className="shrink-0 text-[10px] font-semibold text-[var(--text-muted)]">RDP</span>}
									<span className="max-w-[160px] truncate font-medium">{tab.serverName}</span>
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											closeTab(i);
										}}
										aria-label={t("sshTerminalManager.closeTab", { serverName: tab.serverName })}
										className="ml-1 shrink-0 rounded p-1.5 min-h-11 min-w-11 text-[var(--text-muted)] opacity-100 transition hover:bg-[var(--surface-elevated)] light:hover:bg-[var(--surface-hover)] hover:text-[var(--danger)] sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
									>
										<X size={16} aria-hidden />
									</button>
								</div>
							);
						})}
					</div>
				)}

				{/* Terminal panels — always mounted; only active tab is visible.
				    Minimize does NOT unmount these (keeps WebSocket + xterm alive). */}
				<div className="flex min-h-0 flex-1 flex-col">
					{tabs.map((tab, i) => tab.kind === "rdp" ? (
						<RemoteDesktopPanel
							key={tab.id}
							ref={(handle) => {
								if (handle) panelHandles.current.set(tab.id, handle);
								else panelHandles.current.delete(tab.id);
							}}
							serverId={tab.serverId}
							serverName={tab.serverName}
							host={tab.host}
							visible={!minimized && i === activeTabIndex}
							fullscreen={fullscreen}
							onToggleFullscreen={toggleFullscreen}
							onClose={() => closeTab(i)}
							onStatusChange={(status) => onStatusChange(tab.id, status)}
						/>
					) : (
						<SshTerminalPanel
							key={tab.id}
							ref={(handle) => {
								if (handle) panelHandles.current.set(tab.id, handle);
								else panelHandles.current.delete(tab.id);
							}}
							serverId={tab.serverId}
							serverName={tab.serverName}
							host={tab.host}
							operatingSystem={tab.operatingSystem}
							// When manager is minimized, treat all as not "visible" for
							// layout fit only — connection lifecycle ignores `visible`.
							visible={!minimized && i === activeTabIndex}
							fullscreen={fullscreen}
							onToggleFullscreen={toggleFullscreen}
							onClose={() => onTabClose(i)}
							onStatusChange={(status) => onStatusChange(tab.id, status)}
						/>
					))}
				</div>
			</div>

			<ConfirmDialog
				open={confirmCloseAll && tabs.length > 1}
				title={t("sshTerminalManager.closeAllTitle")}
				description={t("sshTerminalManager.closeAllDescription", { count: tabs.length })}
				confirmLabel={t("sshTerminalManager.closeAllConfirm")}
				cancelLabel={t("common.cancel")}
				onConfirm={() => {
					setConfirmCloseAll(false);
					closeAll();
				}}
				onCancel={() => setConfirmCloseAll(false)}
			/>
		</div>
	);
}
