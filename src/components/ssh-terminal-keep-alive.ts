/**
 * Whether a terminal asks the proxy to keep its shell alive across a dropped
 * browser connection (phone screen lock, network hand-over) so a reconnect
 * continues the same session. Kept in this browser next to the other
 * terminal preferences. Client-safe.
 */
export const SSH_TERMINAL_KEEP_ALIVE_KEY = "ssh-terminal-keep-alive";
export const DEFAULT_SSH_TERMINAL_KEEP_ALIVE = true;

export function parseSshTerminalKeepAlive(raw: string | null): boolean {
	if (raw === "0" || raw === "false") return false;
	if (raw === "1" || raw === "true") return true;
	return DEFAULT_SSH_TERMINAL_KEEP_ALIVE;
}

export function readSshTerminalKeepAlive(storage: Storage): string | null {
	return storage.getItem(SSH_TERMINAL_KEEP_ALIVE_KEY);
}
