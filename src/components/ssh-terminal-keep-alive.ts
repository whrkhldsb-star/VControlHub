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

const RESUME_KEY_PREFIX = "ssh-terminal-resume:";

/**
 * The resumable shell of one server's terminal, kept in this tab's session
 * storage so a reloaded page continues it. A duplicated tab copies it: the
 * gateway then hands the shell to whichever tab connects last and tells the
 * other one so.
 */
export function sshTerminalResumeStore(serverId: string, storage: () => Storage | null = () => window.sessionStorage) {
	const key = `${RESUME_KEY_PREFIX}${serverId}`;
	return {
		load(): string | null {
			try {
				const value = storage()?.getItem(key) ?? null;
				return value && /^[a-f0-9]{32}$/.test(value) ? value : null;
			} catch {
				return null;
			}
		},
		save(id: string | null) {
			try {
				if (id) storage()?.setItem(key, id);
				else storage()?.removeItem(key);
			} catch {
				// Unavailable storage: the shell is still resumable within this page.
			}
		},
	};
}
