import type { Terminal } from "@xterm/xterm";

/**
 * Terminal modes a program switches on and must switch off again when it
 * exits: the alternate screen, mouse tracking and its report encodings, and —
 * cleared together by a soft reset (DECSTR) — a hidden cursor, application
 * cursor/keypad keys, bracketed paste, focus reports, synchronized output,
 * a scroll region, colours and character sets.
 *
 * A program that exits normally undoes them itself. When its exit never
 * reaches this terminal — the connection dropped and the reconnect got a new
 * shell, or the program was killed — they stay on, and the new shell receives
 * a mouse report for every mouse move and wheel step (`^[[<35;12;5M` garbage
 * at the prompt), focus reports on every click, or arrow keys in application
 * mode. Scrollback and the screen content are kept.
 */
const LEAVE_ALTERNATE_SCREEN = "\x1b[?1049l";
// X10, normal, highlight, button-event and any-event tracking, then the
// UTF-8, SGR, urxvt and SGR-pixel report encodings.
const MOUSE_TRACKING_OFF = "\x1b[?9l\x1b[?1000l\x1b[?1001l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?1016l";
const SOFT_RESET = "\x1b[!p";

export type TerminalBufferType = "normal" | "alternate";

/** The bytes that return a terminal to the modes a new shell expects. */
export function terminalModeResetSequence(activeBuffer: TerminalBufferType): string {
	return (activeBuffer === "alternate" ? LEAVE_ALTERNATE_SCREEN : "") + MOUSE_TRACKING_OFF + SOFT_RESET;
}

type ResettableTerminal = Pick<Terminal, "write"> & {
	readonly buffer: { readonly active: { readonly type: TerminalBufferType } };
};

/**
 * Apply the reset locally. Only the browser terminal changes; nothing is sent
 * to the remote shell. Leaving the alternate screen first brings back the
 * normal screen and its scrollback as they were before the program started.
 */
export function resetTerminalModes(term: ResettableTerminal) {
	term.write(terminalModeResetSequence(term.buffer.active.type));
}
