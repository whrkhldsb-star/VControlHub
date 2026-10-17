"use client";

import {
	createSshTerminalConnection,
	type SshConnectionState,
	type SshTerminalConnection,
} from "@/components/ssh-terminal-connection";
import { chainSshTerminalCopyPaste } from "@/components/ssh-terminal-copy-paste";
import { resetTerminalModes } from "@/components/ssh-terminal-modes";
import { installSshTerminalIme } from "@/components/ssh-terminal-ime";
import { installSshTerminalTouchScroll } from "@/components/ssh-terminal-touch-scroll";
import { parseQuickKeyPresets, quickKeyPresetsToEntries, serializeQuickKeyPresets, type QuickKeyPreset } from "@/components/ssh-quick-keys";
import {
	SSH_TERMINAL_FONT_SIZE_KEY,
	clampSshTerminalFontSize,
	parseSshTerminalFontSize,
	readSshTerminalFontSize,
} from "@/components/ssh-terminal-font-size";
import {
	SSH_TERMINAL_KEEP_ALIVE_KEY,
	parseSshTerminalKeepAlive,
	readSshTerminalKeepAlive,
} from "@/components/ssh-terminal-keep-alive";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { SshFileManager } from "@/components/ssh-file-manager";
import { SshTerminalSidePanel } from "@/components/ssh-terminal-side-panel";
import { SshTerminalSearchBar, SshTerminalToolbar } from "@/components/ssh-terminal-chrome";
import type { SshTerminalOperatingSystem, TerminalStatus } from "@/components/ssh-terminal-types";
import { writeLocalStorageValue } from "@/lib/browser-storage";
import { useBrowserStorageSnapshot } from "@/lib/hooks/use-browser-storage-snapshot";
import { AlertTriangle } from "@/components/icons";
import { cn } from "@/lib/ui/cn";
export type { TerminalStatus } from "@/components/ssh-terminal-types";

const FAVORITE_COMMANDS_KEY = "ssh-favorite-commands";
const QUICK_KEY_PRESETS_KEY = "ssh-quick-key-presets";

function readFavoriteCommands(storage: Storage): string | null {
	return storage.getItem(FAVORITE_COMMANDS_KEY);
}

function readQuickKeyPresets(storage: Storage): string | null {
	return storage.getItem(QUICK_KEY_PRESETS_KEY);
}

function parseFavoriteCommands(raw: string | null): string[] {
	try {
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
	} catch {
		return [];
	}
}

/* ------------------------------------------------------------------ */
/* SshTerminalPanel — single-tab terminal logic (extracted from modal) */
/* ------------------------------------------------------------------ */


export type SshTerminalPanelProps = {
	serverId: string;
	serverName: string;
	host: string;
	/** Shell family used to choose commands that are safe for this server. */
	operatingSystem?: SshTerminalOperatingSystem;
	/** When false, the panel is hidden via CSS but keeps its WS + terminal alive. */
	visible: boolean;
	/** Called when the user clicks the close button on this tab. */
	onClose: () => void;
	/** Called when connection status changes (for tab badge display). */
	onStatusChange?: (status: TerminalStatus) => void;
	/** Full screen: the terminal fills the viewport, chrome shrinks to a strip. */
	fullscreen?: boolean;
	/** Absent when the host offers no full-screen mode. */
	onToggleFullscreen?: () => void;
};

export function SshTerminalPanel({
	serverId,
	serverName,
	host,
	operatingSystem = "LINUX",
	visible,
	onClose,
	onStatusChange,
	fullscreen = false,
	onToggleFullscreen,
}: SshTerminalPanelProps) {
	const { t } = useI18n();
	// Keep the translator reachable from async WS callbacks without adding `t`
	// to the connection effect deps — a locale switch must NOT tear down live
	// terminals (WebSocket + xterm lifecycle depends on [serverId] only).
	const tRef = useRef(t);
	useEffect(() => { tRef.current = t; }, [t]);
	const termRef = useRef<HTMLDivElement>(null);
	const terminalRef = useRef<import("@xterm/xterm").Terminal | null>(null);
	const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
	const searchAddonRef = useRef<import("@xterm/addon-search").SearchAddon | null>(null);
	const connectionRef = useRef<SshTerminalConnection | null>(null);
	const currentCommandRef = useRef("");

	const [connectionState, setConnectionState] = useState<SshConnectionState>({
		status: "connecting",
		message: "",
		retryAt: null,
		waitingForUser: false,
	});
	const status: TerminalStatus = connectionState.status;
	const errorMsg = connectionState.message;
	const [inputError, setInputError] = useState<string>("");
	const [clipboardError, setClipboardError] = useState(false);
	const [showSidePanel, setShowSidePanel] = useState(false);
	const [showFileManager, setShowFileManager] = useState(false);
	const [terminalSearch, setTerminalSearch] = useState("");
	const [commandHistory, setCommandHistory] = useState<string[]>([]);
	const storedFavoriteCommands = useBrowserStorageSnapshot(FAVORITE_COMMANDS_KEY, readFavoriteCommands, null);
	const favoriteCommands = useMemo(() => parseFavoriteCommands(storedFavoriteCommands), [storedFavoriteCommands]);
	const [newFavorite, setNewFavorite] = useState("");
	const storedQuickKeyPresets = useBrowserStorageSnapshot(QUICK_KEY_PRESETS_KEY, readQuickKeyPresets, null);
	const quickKeyPresets = useMemo(() => parseQuickKeyPresets(storedQuickKeyPresets), [storedQuickKeyPresets]);
	const customQuickKeys = useMemo(
		() => (quickKeyPresets ? quickKeyPresetsToEntries(quickKeyPresets) : null),
		[quickKeyPresets],
	);

	const storedFontSize = useBrowserStorageSnapshot(SSH_TERMINAL_FONT_SIZE_KEY, readSshTerminalFontSize, null);
	const fontSize = parseSshTerminalFontSize(storedFontSize);
	// Read by the terminal effect when it builds the terminal, without
	// making the font size a reason to rebuild it.
	const fontSizeRef = useRef(fontSize);

	const storedKeepAlive = useBrowserStorageSnapshot(SSH_TERMINAL_KEEP_ALIVE_KEY, readSshTerminalKeepAlive, null);
	const keepAlive = parseSshTerminalKeepAlive(storedKeepAlive);
	const keepAliveRef = useRef(keepAlive);
	useEffect(() => { keepAliveRef.current = keepAlive; }, [keepAlive]);
	/** Bumped once the terminal exists, so the connection effect can wait for it. */
	const [terminalGeneration, setTerminalGeneration] = useState(0);
	const [keepAliveMs, setKeepAliveMs] = useState(0);
	const [sessionNotice, setSessionNotice] = useState<"resumed" | "resumedPartial" | "fresh" | null>(null);

	// Notify parent of status changes
	useEffect(() => {
		onStatusChange?.(status);
	}, [status, onStatusChange]);

	/** Size the grid to the surface and tell the remote PTY; a no-op before the terminal exists. */
	const fitTerminal = useCallback(() => {
		const fitAddon = fitAddonRef.current;
		if (!terminalRef.current || !fitAddon) return;
		try {
			fitAddon.fit();
		} catch {
			return;
		}
		connectionRef.current?.resize();
	}, []);

	// Refit terminal when tab becomes visible (xterm needs visible DOM to fit)
	useEffect(() => {
		if (!visible) return;
		// Small delay to ensure DOM is visible before fit
		const timer = setTimeout(fitTerminal, 50);
		return () => clearTimeout(timer);
	}, [visible, fitTerminal]);

	// A new font size changes the cell size, so the grid must be measured again.
	useEffect(() => {
		fontSizeRef.current = fontSize;
		const term = terminalRef.current;
		if (!term || term.options.fontSize === fontSize) return;
		term.options.fontSize = fontSize;
		fitTerminal();
	}, [fontSize, fitTerminal]);

	// The terminal outlives its connections: a reconnect keeps the scrollback
	// and, when the proxy still has the shell, continues it where it was.
	useEffect(() => {
		const surface = termRef.current;
		if (!surface) return;

		let disposed = false;
		let cleanup: (() => void) | undefined;

		async function create() {
			const [{ Terminal }, { FitAddon }, { SearchAddon }] = await Promise.all([
				import("@xterm/xterm"),
				import("@xterm/addon-fit"),
				import("@xterm/addon-search"),
			]);
			await import("@xterm/xterm/css/xterm.css");
			if (disposed || !surface) return;

			const term = new Terminal({
				cursorBlink: true,
				fontSize: fontSizeRef.current,
				fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
				// Plenty of history to scroll back through after long commands.
				scrollback: 5000,
				theme: {
					background: "#0a0e1a",
					foreground: "#e2e8f0",
					cursor: "#22d3ee",
					cursorAccent: "#0a0e1a",
					selectionBackground: "#164e63",
					black: "#1e293b",
					red: "#f87171",
					green: "#4ade80",
					yellow: "#facc15",
					blue: "#60a5fa",
					magenta: "#c084fc",
					cyan: "#22d3ee",
					white: "#e2e8f0",
					brightBlack: "#475569",
					brightRed: "#fca5a5",
					brightGreen: "#86efac",
					brightYellow: "#fde68a",
					brightBlue: "#93c5fd",
					brightMagenta: "#d8b4fe",
					brightCyan: "#67e8f9",
					brightWhite: "#f8fafc",
				},
				allowProposedApi: true,
			});

			const fitAddon = new FitAddon();
			const searchAddon = new SearchAddon();
			term.loadAddon(fitAddon);
			term.loadAddon(searchAddon);
			term.open(surface);
			// Key handler chain: IME forwarding runs first (mobile punctuation),
			// copy/paste chords second. installSshTerminalIme attaches the
			// combined handler to xterm's single custom-key slot.
			const copyPasteHandler = chainSshTerminalCopyPaste(term, () => true, (copied) => {
				if (!disposed) setClipboardError(!copied);
			});
			const removeIme = installSshTerminalIme(term, copyPasteHandler);
			fitAddon.fit();

			terminalRef.current = term;
			fitAddonRef.current = fitAddon;
			searchAddonRef.current = searchAddon;

			const removeTouchScroll = installSshTerminalTouchScroll(term, surface);

			term.onData((data: string) => {
				if (!connectionRef.current?.send(data)) return;
				setInputError("");
				if (data === "\r" || data === "\n") {
					const cmd = currentCommandRef.current.trim();
					currentCommandRef.current = "";
					if (cmd) {
						setCommandHistory((prev) => [cmd, ...prev.filter((c) => c !== cmd)].slice(0, 50));
					}
				} else if (data === "\u007f" || data === "\b") {
					currentCommandRef.current = currentCommandRef.current.slice(0, -1);
				} else if (!data.startsWith("\u001b") && data >= " ") {
					currentCommandRef.current += data;
				}
			});

			// The surface changes size with the window, the mobile drag handle,
			// full screen, the side panel and the on-screen keyboard. Observe the
			// element itself where the browser allows, one measurement per frame;
			// a hidden tab (0 × 0) waits for the `visible` refit instead.
			let pendingFrame = 0;
			const refitSurface = () => {
				if (pendingFrame) return;
				pendingFrame = requestAnimationFrame(() => {
					pendingFrame = 0;
					if (surface.clientHeight > 0) fitTerminal();
				});
			};
			const observer = typeof ResizeObserver === "function" ? new ResizeObserver(refitSurface) : null;
			if (observer) observer.observe(surface);
			else window.addEventListener("resize", refitSurface);

			cleanup = () => {
				removeIme();
				removeTouchScroll();
				observer?.disconnect();
				window.removeEventListener("resize", refitSurface);
				if (pendingFrame) cancelAnimationFrame(pendingFrame);
				try { term.dispose(); } catch {}
				if (terminalRef.current === term) terminalRef.current = null;
				fitAddonRef.current = null;
				searchAddonRef.current = null;
			};
			setTerminalGeneration((generation) => generation + 1);
		}

		void create();

		return () => {
			disposed = true;
			cleanup?.();
		};
	}, [serverId, fitTerminal]);

	// One connection controller per terminal: it fetches handshake tokens,
	// resumes kept shells, retries drops and resets the terminal's modes when a
	// reconnect lands on a new shell (see ssh-terminal-connection).
	useEffect(() => {
		const term = terminalRef.current;
		if (!term) return;
		const connection = createSshTerminalConnection({
			serverId,
			terminal: term,
			fitGrid: () => {
				try { fitAddonRef.current?.fit(); } catch { /* hidden surface: the visible refit sizes it */ }
			},
			keepAlive: () => keepAliveRef.current,
			fetchHandshakeToken: async () => {
				const data = await csrfFetch<{ token?: string }>("/api/auth/ws-token", {
					method: "POST",
					body: JSON.stringify({ serverId }),
				});
				return data.token || "";
			},
			location: window.location,
			t: (key) => tRef.current(key),
			onState: setConnectionState,
			onSession: (info) => {
				setKeepAliveMs(info.keepAliveMs);
				if (info.afterReconnect) {
					setSessionNotice(info.resumed ? (info.replayTruncated ? "resumedPartial" : "resumed") : "fresh");
				}
			},
			onInputOverflow: () => setInputError(tRef.current("sshTerminalModal.errInputTooLarge")),
		});
		connectionRef.current = connection;
		connection.start();
		return () => {
			connection.dispose();
			if (connectionRef.current === connection) connectionRef.current = null;
		};
	}, [serverId, terminalGeneration]);

	// A phone coming back from the lock screen, or a laptop regaining its
	// network, retries at once instead of waiting for the next scheduled try.
	useEffect(() => {
		const wake = () => {
			if (document.visibilityState === "visible") connectionRef.current?.wake();
		};
		window.addEventListener("online", wake);
		document.addEventListener("visibilitychange", wake);
		return () => {
			window.removeEventListener("online", wake);
			document.removeEventListener("visibilitychange", wake);
		};
	}, []);

	// Seconds until the next automatic attempt, for the banner.
	const [retryInSeconds, setRetryInSeconds] = useState<number | null>(null);
	useEffect(() => {
		const retryAt = connectionState.retryAt;
		const update = () => setRetryInSeconds(retryAt === null ? null : Math.max(1, Math.ceil((retryAt - Date.now()) / 1000)));
		const first = setTimeout(update, 0);
		const ticker = retryAt === null ? null : setInterval(update, 1000);
		return () => {
			clearTimeout(first);
			if (ticker) clearInterval(ticker);
		};
	}, [connectionState.retryAt]);

	// The seam notice is transient; the terminal content is the real record.
	useEffect(() => {
		if (!sessionNotice) return;
		const timer = setTimeout(() => setSessionNotice(null), 8000);
		return () => clearTimeout(timer);
	}, [sessionNotice]);

	const changeFontSize = (size: number) => {
		writeLocalStorageValue(SSH_TERMINAL_FONT_SIZE_KEY, String(clampSshTerminalFontSize(size)));
	};

	const saveFavorites = (items: string[]) => {
		writeLocalStorageValue(FAVORITE_COMMANDS_KEY, JSON.stringify(items));
	};

	const addFavorite = () => {
		const cmd = newFavorite.trim();
		if (!cmd || favoriteCommands.includes(cmd)) return;
		const next = [...favoriteCommands, cmd];
		saveFavorites(next);
		setNewFavorite("");
	};

	const removeFavorite = (cmd: string) => {
		const next = favoriteCommands.filter((c) => c !== cmd);
		saveFavorites(next);
	};

	const addQuickKeyPreset = (preset: QuickKeyPreset) => {
		const current = quickKeyPresets ?? [];
		if (current.some((p) => p.label === preset.label)) return;
		const next = [...current, preset];
		writeLocalStorageValue(QUICK_KEY_PRESETS_KEY, serializeQuickKeyPresets(next));
	};

	const resetQuickKeyPresets = () => {
		writeLocalStorageValue(QUICK_KEY_PRESETS_KEY, serializeQuickKeyPresets([]));
	};

	const sendCommand = (cmd: string) => {
		if (connectionRef.current?.send(cmd + "\r")) setInputError("");
	};

	/** Send raw key sequences (Ctrl+C, arrows, …) without appending Enter. */
	const sendKeys = (data: string) => {
		if (connectionRef.current?.send(data)) setInputError("");
		// Keys that rewrite or discard the pending input line invalidate the
		// tracked current command; keep the panel's history accurate for them.
		if (data === "\u0003" || data === "\u0015" || data === "\u001b[A" || data === "\u001b[B") {
			currentCommandRef.current = "";
		}
	};

	const searchTerminal = (direction: "next" | "previous" = "next") => {
		const query = terminalSearch.trim();
		if (!query || !searchAddonRef.current) return;
		if (direction === "previous") { searchAddonRef.current.findPrevious(query); }
		else { searchAddonRef.current.findNext(query); }
	};

	const clearTerminalSearch = () => {
		setTerminalSearch("");
		searchAddonRef.current?.clearDecorations();
	};

	const handleReconnect = () => {
		setInputError("");
		connectionRef.current?.reconnect();
	};

	/** Undo modes a crashed program left on (mouse reports, hidden cursor…); local only. */
	const resetTerminal = () => {
		const term = terminalRef.current;
		if (!term) return;
		resetTerminalModes(term);
		term.focus();
	};

	const changeKeepAlive = (value: boolean) => {
		writeLocalStorageValue(SSH_TERMINAL_KEEP_ALIVE_KEY, value ? "1" : "0");
	};

	return (
		<div
			className="flex min-h-0 flex-1 flex-col"
			style={{ display: visible ? "flex" : "none" }}
			data-testid={`ssh-terminal-panel-${serverId}`}
		>
			<SshTerminalToolbar
				serverName={serverName}
				host={host}
				status={status}
				t={t}
				showSidePanel={showSidePanel}
				showFileManager={showFileManager}
				fullscreen={fullscreen}
				onToggleSidePanel={() => setShowSidePanel(!showSidePanel)}
				onToggleFileManager={() => setShowFileManager(!showFileManager)}
				onToggleFullscreen={onToggleFullscreen}
				onReconnect={handleReconnect}
				onClose={onClose}
			/>

			{/* Error banner */}
			{errorMsg && (status === "error" || status === "closed") && (
				<div data-tone="rose" className="mx-4 mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-[var(--danger-border)] px-4 py-2 text-sm text-[var(--danger)]">
					<AlertTriangle size={15} className="shrink-0" aria-hidden="true" />
					<span className="min-w-0 break-words">{errorMsg}</span>
					{retryInSeconds !== null && (
						<span className="text-xs text-[var(--text-muted)]" data-testid="ssh-terminal-retry">
							{t("sshTerminalModal.autoReconnectIn", { seconds: retryInSeconds })}
						</span>
					)}
				</div>
			)}

			{/* Terminal + side panel */}
			{inputError && <p role="alert" className="mx-4 mt-3 text-sm text-[var(--danger)]">{inputError}</p>}
			{clipboardError && <p role="alert" className="mx-4 mt-3 text-sm text-[var(--danger)]">{t("sshTerminalModal.errClipboardCopy")}</p>}
			{sessionNotice && (
				<p role="status" className="mx-4 mt-3 text-xs text-[var(--text-secondary)]" data-testid="ssh-terminal-session-notice">
					{t(
						sessionNotice === "fresh"
							? "sshTerminalModal.sessionFresh"
							: sessionNotice === "resumedPartial" ? "sshTerminalModal.sessionResumedPartial" : "sshTerminalModal.sessionResumed",
					)}
				</p>
			)}
			<div
				className={cn(
					"flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain lg:flex-row lg:overflow-hidden",
					fullscreen ? "gap-2 p-1" : "gap-3 p-3",
				)}
			>
				<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
					{/* Full screen gives the search bar's rows to the terminal. */}
					{!fullscreen && (
						<SshTerminalSearchBar
							serverId={serverId}
							t={t}
							terminalSearch={terminalSearch}
							onSearchChange={setTerminalSearch}
							onSearch={searchTerminal}
							onClear={clearTerminalSearch}
						/>
					)}
					{/* The border lives on this frame, not on the element xterm is
					    fitted to: FitAddon sizes the grid from its host's computed
					    box, and with border-box sizing a bordered host reports the
					    border as usable space. On wide screens the surface takes
					    exactly the space left in the dialog — a fixed minimum there
					    made the grid taller than the visible area, so the bottom
					    rows (prompt and cursor) were clipped outside full screen.
					    Below lg the same holds unless a side panel is stacked under
					    the terminal: only then keep a usable minimum and let the
					    column scroll between terminal and panel. */}
					<div
						className={cn(
							"flex min-h-0 min-w-0 flex-1 w-full overflow-hidden bg-[var(--surface-root)]",
							(showFileManager || showSidePanel) && "min-h-[280px] lg:min-h-0",
							fullscreen ? "rounded-lg" : "rounded-xl border border-[var(--border-subtle)] light:border-[var(--border)]",
						)}
					>
						<div ref={termRef} data-testid="ssh-terminal-surface" className="min-h-0 min-w-0 flex-1 overflow-hidden" />
					</div>
				</div>
				{showFileManager && (
				<SshFileManager serverId={serverId} visible={showFileManager} />
			)}
			{showSidePanel && (
					<SshTerminalSidePanel
						serverId={serverId}
						operatingSystem={operatingSystem}
						t={t}
						favoriteCommands={favoriteCommands}
						newFavorite={newFavorite}
						setNewFavorite={setNewFavorite}
						addFavorite={addFavorite}
						removeFavorite={removeFavorite}
						commandHistory={commandHistory}
						sendCommand={sendCommand}
						sendKeys={sendKeys}
						customQuickKeys={customQuickKeys}
						onAddQuickKey={addQuickKeyPreset}
						onResetQuickKeys={resetQuickKeyPresets}
						fontSize={fontSize}
						onFontSizeChange={changeFontSize}
						keepAlive={keepAlive}
						keepAliveMinutes={keepAliveMs > 0 ? Math.round(keepAliveMs / 60_000) : null}
						onKeepAliveChange={changeKeepAlive}
						onResetTerminal={resetTerminal}
					/>
				)}
			</div>
		</div>
	);
}
