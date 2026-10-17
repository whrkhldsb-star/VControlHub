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
export const MOUSE_TRACKING_OFF = "\x1b[?9l\x1b[?1000l\x1b[?1001l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?1016l";
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

const SGR_MOUSE_REPORT = /\x1b\[<(\d{1,4};\d{1,4};\d{1,4}[Mm])/g;
const ESCAPE_SEQUENCE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;
const REPORT_MEMORY_MS = 3_000;
const MAX_REMEMBERED_REPORTS = 32;

/**
 * Recognises mouse tracking left on with nobody to read it. Mouse reports go
 * to the remote side as input; a full-screen program consumes them, but a
 * plain shell prints them back as text (`<35;12;5M`, or `^[[<35;12;5M`). When
 * output shows a report this terminal sent moments ago, the program that
 * enabled tracking is gone — killed, crashed, or lost with an old connection —
 * and tracking can be switched off before the wheel floods the prompt.
 */
export function createMouseEchoGuard(now: () => number = Date.now) {
	const sent: Array<{ tail: string; at: number }> = [];
	let recentOutput = "";
	const forgetOld = () => {
		const cutoff = now() - REPORT_MEMORY_MS;
		while (sent.length > 0 && (sent[0]!.at < cutoff || sent.length > MAX_REMEMBERED_REPORTS)) sent.shift();
	};
	return {
		/** Note the mouse reports in input about to be sent. */
		input(data: string) {
			if (!data.includes("\x1b[<")) return;
			for (const match of data.matchAll(SGR_MOUSE_REPORT)) sent.push({ tail: match[1]!, at: now() });
			forgetOld();
		},
		/** True when this output echoes a report sent moments ago as plain text. */
		echoed(output: Uint8Array): boolean {
			forgetOld();
			if (sent.length === 0) {
				recentOutput = "";
				return false;
			}
			// Reports are ASCII; a byte-wise view is enough and survives split characters.
			let text = "";
			for (let index = 0; index < output.length; index += 1) text += String.fromCharCode(output[index]!);
			recentOutput = (recentOutput + text).replace(ESCAPE_SEQUENCE, "").slice(-256);
			if (!sent.some((report) => recentOutput.includes(report.tail))) return false;
			sent.length = 0;
			recentOutput = "";
			return true;
		},
	};
}
