import type { Terminal } from "@xterm/xterm";

type TouchScrollTerminal = Pick<Terminal, "rows" | "buffer" | "modes" | "scrollLines">;

/**
 * Mobile touch scrolling for the SSH terminal.
 *
 * xterm's scrollable viewport sits beneath the screen canvas, so finger drags
 * never reach it natively; they would only scroll the surrounding panel.
 * A one-finger vertical drag therefore acts like the mouse wheel:
 *
 * - Normal screen: the drag moves the scrollback, and is handed back to the
 *   panel once the scrollback reaches its top or bottom.
 * - Full-screen programs (Codex, Claude Code, vim, less) switch to the
 *   alternate screen, which has no scrollback; the history they show is their
 *   own. Each line of drag becomes one wheel step dispatched to xterm, which
 *   reports it to a program that enabled mouse tracking, or sends an arrow key
 *   to one that did not, exactly as a desktop mouse wheel would.
 */
export function installSshTerminalTouchScroll(term: TouchScrollTerminal, surface: HTMLElement) {
	const screenEl = surface.querySelector<HTMLElement>(".xterm-screen");
	let lastX = 0;
	let lastY = 0;
	let pendingPx = 0;

	const cellHeight = () => (screenEl && term.rows > 0 ? screenEl.clientHeight / term.rows : 16);

	const onTouchStart = (event: TouchEvent) => {
		if (event.touches.length !== 1) return;
		lastX = event.touches[0]?.clientX ?? 0;
		lastY = event.touches[0]?.clientY ?? 0;
		pendingPx = 0;
	};

	const onTouchMove = (event: TouchEvent) => {
		if (event.touches.length !== 1 || event.defaultPrevented) return;
		const touch = event.touches[0];
		const x = touch?.clientX ?? lastX;
		const y = touch?.clientY ?? lastY;
		const deltaPx = y - lastY;
		lastX = x;
		lastY = y;
		if (deltaPx === 0) return;

		const programOwnsScrolling = term.modes.mouseTrackingMode !== "none" || term.buffer.active.type === "alternate";
		if (!programOwnsScrolling) {
			const buffer = term.buffer.active;
			const canScroll =
				(deltaPx > 0 && buffer.viewportY > 0)
				|| (deltaPx < 0 && buffer.viewportY + term.rows < buffer.length);
			if (!canScroll) {
				// At a scrollback edge: let the surrounding panel scroll instead.
				pendingPx = 0;
				return;
			}
		}

		event.preventDefault();
		const height = cellHeight();
		if (height <= 0) return;
		// A finger moving down reveals older lines: negative lines, wheel up.
		pendingPx -= deltaPx;
		const lines = Math.trunc(pendingPx / height);
		if (lines === 0) return;
		pendingPx -= lines * height;
		if (!programOwnsScrolling) {
			term.scrollLines(lines);
			return;
		}
		const target = screenEl ?? surface;
		for (let step = 0; step < Math.abs(lines); step += 1) {
			target.dispatchEvent(new WheelEvent("wheel", {
				deltaY: Math.sign(lines),
				deltaMode: WheelEvent.DOM_DELTA_LINE,
				clientX: x,
				clientY: y,
				bubbles: true,
				cancelable: true,
			}));
		}
	};

	surface.addEventListener("touchstart", onTouchStart, { passive: true });
	surface.addEventListener("touchmove", onTouchMove, { passive: false });
	return () => {
		surface.removeEventListener("touchstart", onTouchStart);
		surface.removeEventListener("touchmove", onTouchMove);
	};
}
