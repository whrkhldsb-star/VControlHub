/**
 * The terminal font size the user picked, kept in this browser alongside the
 * favourite commands and quick keys. A phone reads better a step or two
 * larger; a wide monitor fits more columns a step smaller. Client-safe.
 */
export const SSH_TERMINAL_FONT_SIZE_KEY = "ssh-terminal-font-size";
export const DEFAULT_SSH_TERMINAL_FONT_SIZE = 14;
export const MIN_SSH_TERMINAL_FONT_SIZE = 10;
export const MAX_SSH_TERMINAL_FONT_SIZE = 24;

export function clampSshTerminalFontSize(value: number): number {
	if (!Number.isFinite(value)) return DEFAULT_SSH_TERMINAL_FONT_SIZE;
	return Math.min(MAX_SSH_TERMINAL_FONT_SIZE, Math.max(MIN_SSH_TERMINAL_FONT_SIZE, Math.round(value)));
}

/** The stored size, or the default when nothing usable is stored. */
export function parseSshTerminalFontSize(raw: string | null): number {
	if (raw === null || raw.trim() === "") return DEFAULT_SSH_TERMINAL_FONT_SIZE;
	return clampSshTerminalFontSize(Number(raw));
}

export function readSshTerminalFontSize(storage: Storage): string | null {
	return storage.getItem(SSH_TERMINAL_FONT_SIZE_KEY);
}
