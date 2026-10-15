import type { Terminal } from "@xterm/xterm";

type CopyCapableTerminal = Pick<
	Terminal,
	"attachCustomKeyEventHandler" | "hasSelection" | "getSelection" | "clearSelection" | "input"
>;

/**
 * Copy/paste shortcuts for the SSH terminal.
 *
 * xterm.js swallows keydown on its hidden textarea: a browser copy
 * (Ctrl/Cmd+C) never happens, and the keystroke is delivered to the shell as
 * ^C — interrupting the running command instead of copying the selection the
 * user just made. Windows users especially expect select → Ctrl+C to copy.
 *
 * xterm exposes a single customKeyEventHandler slot which other modules
 * (IME punctuation forwarding) also need, so both installers agree on a chain
 * protocol: a handler wraps `next` and calls it for everything it does not
 * claim. Claimed events return false (xterm then ignores the key).
 *
 * - Ctrl/Cmd+C **with an active selection** → copy to the clipboard, clear the
 *   selection. Without a selection the chord falls through to the shell as a
 *   real ^C, so interrupting a running command still works.
 * - Ctrl+Shift+C is left alone on purpose: terminals treat it as ^C.
 * - Ctrl/Cmd+V → read the clipboard and feed it through `term.input` — the
 *   same path as xterm's own paste handling, so bracketed paste and the
 *   paste-size guard in the input sender still apply.
 * - Clipboard failures are silent: the chord falls through unchanged.
 */
export function chainSshTerminalCopyPaste(
	term: CopyCapableTerminal,
	next: (event: KeyboardEvent) => boolean,
): (event: KeyboardEvent) => boolean {
	const clipboard = navigator.clipboard;

	return (event: KeyboardEvent): boolean => {
		if (event.type === "keydown") {
			const key = event.key.toLowerCase();
			const plainC = key === "c" && !event.shiftKey && !event.altKey;
			if (plainC && (event.metaKey !== event.ctrlKey)) {
				// Exactly one of Ctrl/Cmd is held (Ctrl on Linux/Windows,
				// Cmd on macOS). With a selection this is a copy request.
				if (term.hasSelection()) {
					const text = term.getSelection();
					if (text) {
						void clipboard.writeText(text).then(
							() => term.clearSelection(),
							() => {},
						);
						return false;
					}
				}
				// No selection: fall through — the shell receives ^C.
				return next(event);
			}
			const plainV = key === "v" && !event.shiftKey && !event.altKey;
			if (plainV && (event.metaKey !== event.ctrlKey)) {
				void clipboard.readText().then(
					(text) => {
						if (text) term.input(text, true);
					},
					() => {},
				);
				return false;
			}
		}
		return next(event);
	};
}
