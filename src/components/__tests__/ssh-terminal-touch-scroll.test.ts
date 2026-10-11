import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";

import { installSshTerminalTouchScroll } from "../ssh-terminal-touch-scroll";

type Mode = "none" | "x10" | "vt200" | "drag" | "any";

function makeTerm(options: { type?: "normal" | "alternate"; mouse?: Mode; viewportY?: number; length?: number } = {}) {
	return {
		rows: 24,
		buffer: { active: { type: options.type ?? "normal", viewportY: options.viewportY ?? 10, length: options.length ?? 100 } },
		modes: { mouseTrackingMode: options.mouse ?? "none" },
		scrollLines: vi.fn(),
	};
}

/** jsdom has no TouchEvent: dispatch a cancelable Event carrying a touches list. */
function fireTouch(element: HTMLElement, type: "touchstart" | "touchmove", clientY: number, { clientX = 40, fingers = 1 } = {}) {
	const event = new Event(type, { cancelable: true, bubbles: true });
	Object.defineProperty(event, "touches", { value: Array.from({ length: fingers }, () => ({ clientX, clientY })) });
	element.dispatchEvent(event);
	return event;
}

describe("installSshTerminalTouchScroll", () => {
	let surface: HTMLElement;
	let screenEl: HTMLElement;
	let wheels: WheelEvent[];

	beforeEach(() => {
		surface = document.createElement("div");
		screenEl = document.createElement("div");
		screenEl.className = "xterm-screen";
		// 24 rows in 480px: one row per 20px of finger travel.
		Object.defineProperty(screenEl, "clientHeight", { value: 480 });
		surface.appendChild(screenEl);
		wheels = [];
		screenEl.addEventListener("wheel", (event) => wheels.push(event));
	});

	const install = (term: ReturnType<typeof makeTerm>) => installSshTerminalTouchScroll(term as unknown as Terminal, surface);

	it("moves the scrollback of the normal screen, one line per row of finger travel", () => {
		const term = makeTerm();
		install(term);
		fireTouch(surface, "touchstart", 300);
		const down = fireTouch(surface, "touchmove", 350); // finger down 50px: older lines
		expect(down.defaultPrevented).toBe(true);
		expect(term.scrollLines).toHaveBeenCalledWith(-2);
		fireTouch(surface, "touchmove", 290); // finger up 60px from 350, with 10px carried over
		expect(term.scrollLines).toHaveBeenLastCalledWith(2);
		expect(wheels).toHaveLength(0);
	});

	it("hands the gesture back to the page at either end of the scrollback", () => {
		const term = makeTerm({ viewportY: 0 });
		install(term);
		fireTouch(surface, "touchstart", 300);
		expect(fireTouch(surface, "touchmove", 360).defaultPrevented).toBe(false);
		term.buffer.active.viewportY = 76; // + rows(24) === length(100)
		fireTouch(surface, "touchstart", 300);
		expect(fireTouch(surface, "touchmove", 240).defaultPrevented).toBe(false);
		expect(term.scrollLines).not.toHaveBeenCalled();
	});

	it("turns drags into wheel steps for full-screen programs that track the mouse (Codex, Claude Code)", () => {
		const term = makeTerm({ type: "alternate", mouse: "any", viewportY: 0, length: 24 });
		install(term);
		fireTouch(surface, "touchstart", 100, { clientX: 70 });
		const down = fireTouch(surface, "touchmove", 165, { clientX: 72 }); // 65px: three rows
		expect(down.defaultPrevented).toBe(true);
		expect(wheels.map((wheel) => wheel.deltaY)).toEqual([-1, -1, -1]);
		expect(wheels[0]).toMatchObject({ deltaMode: WheelEvent.DOM_DELTA_LINE, clientX: 72, clientY: 165, bubbles: true, cancelable: true });
		fireTouch(surface, "touchmove", 120, { clientX: 72 }); // up 45px, plus the 5px left over
		expect(wheels.slice(3).map((wheel) => wheel.deltaY)).toEqual([1, 1]);
		expect(term.scrollLines).not.toHaveBeenCalled();
	});

	it("also sends wheel steps on the alternate screen without mouse tracking, where xterm turns them into arrow keys (less, vim)", () => {
		const term = makeTerm({ type: "alternate", mouse: "none", viewportY: 0, length: 24 });
		install(term);
		fireTouch(surface, "touchstart", 300);
		expect(fireTouch(surface, "touchmove", 260).defaultPrevented).toBe(true);
		expect(wheels.map((wheel) => wheel.deltaY)).toEqual([1, 1]);
		expect(term.scrollLines).not.toHaveBeenCalled();
	});

	it("lets a program that tracks the mouse on the normal screen own the wheel, as a desktop wheel would", () => {
		const term = makeTerm({ mouse: "vt200" });
		install(term);
		fireTouch(surface, "touchstart", 300);
		fireTouch(surface, "touchmove", 340);
		expect(wheels.map((wheel) => wheel.deltaY)).toEqual([-1, -1]);
		expect(term.scrollLines).not.toHaveBeenCalled();
	});

	it("ignores multi-finger gestures and moves another handler already consumed", () => {
		const term = makeTerm({ type: "alternate", mouse: "any" });
		install(term);
		fireTouch(surface, "touchstart", 300, { fingers: 2 });
		expect(fireTouch(surface, "touchmove", 380, { fingers: 2 }).defaultPrevented).toBe(false);
		surface.addEventListener("touchmove", (event) => event.preventDefault(), { capture: true, once: true });
		fireTouch(surface, "touchstart", 300);
		fireTouch(surface, "touchmove", 380);
		expect(wheels).toHaveLength(0);
	});

	it("stops listening once removed", () => {
		const term = makeTerm({ type: "alternate", mouse: "any" });
		const remove = install(term);
		remove();
		fireTouch(surface, "touchstart", 300);
		expect(fireTouch(surface, "touchmove", 380).defaultPrevented).toBe(false);
		expect(wheels).toHaveLength(0);
	});
});
