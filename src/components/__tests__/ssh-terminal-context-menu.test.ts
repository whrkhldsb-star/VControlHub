import { afterEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";

import { installSshTerminalContextMenuCopy } from "../ssh-terminal-context-menu";

type Mode = "none" | "x10" | "vt200" | "drag" | "any";

/** surface > .xterm > (.xterm-screen, helper textarea), like the panel after term.open(). */
function setup(options: { mouse?: Mode; selection?: string } = {}) {
	const surface = document.createElement("div");
	const element = document.createElement("div");
	const screen = document.createElement("div");
	screen.className = "xterm-screen";
	const textarea = document.createElement("textarea");
	element.append(screen, textarea);
	surface.append(element);
	document.body.append(surface);
	let selection = options.selection ?? "COPY-ME";
	const term = {
		element,
		textarea,
		modes: { mouseTrackingMode: options.mouse ?? "any" },
		hasSelection: () => selection.length > 0,
		getSelection: () => selection,
	} as unknown as Terminal;
	// Stands in for xterm's own listeners, which would report to the program.
	const reachedXterm = vi.fn();
	screen.addEventListener("mousedown", reachedXterm);
	screen.addEventListener("mousemove", reachedXterm);
	const onSelectHint = vi.fn();
	const remove = installSshTerminalContextMenuCopy(term, surface, onSelectHint);
	return { screen, textarea, reachedXterm, onSelectHint, remove, clearSelection: () => { selection = ""; } };
}

const rightPress = () => new MouseEvent("mousedown", { button: 2, buttons: 2, bubbles: true, cancelable: true, clientX: 40, clientY: 12 });
const hover = (buttons = 0) => new MouseEvent("mousemove", { buttons, bubbles: true, clientX: 44, clientY: 12 });

afterEach(() => { document.body.innerHTML = ""; });

describe("installSshTerminalContextMenuCopy", () => {
	it("keeps a right click on a selection from the program and offers the text to the browser menu", () => {
		const lab = setup();
		const press = rightPress();
		lab.screen.dispatchEvent(press);
		expect(lab.reachedXterm).not.toHaveBeenCalled();
		expect(press.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(lab.textarea);
		expect(lab.textarea.value).toBe("COPY-ME");
		expect([lab.textarea.selectionStart, lab.textarea.selectionEnd]).toEqual([0, 7]);
		expect(lab.onSelectHint).not.toHaveBeenCalled();
	});

	it("keeps hover moves from clearing the selection, but lets drags through", () => {
		const lab = setup();
		lab.screen.dispatchEvent(hover());
		expect(lab.reachedXterm).not.toHaveBeenCalled();
		lab.screen.dispatchEvent(hover(1));
		expect(lab.reachedXterm).toHaveBeenCalledTimes(1);
	});

	it("sends a right click without a selection to the program and asks for the select hint", () => {
		const lab = setup({ selection: "" });
		lab.screen.dispatchEvent(rightPress());
		lab.screen.dispatchEvent(hover());
		expect(lab.reachedXterm).toHaveBeenCalledTimes(2);
		expect(lab.onSelectHint).toHaveBeenCalledTimes(1);
		expect(lab.textarea.value).toBe("");
	});

	it("leaves a plain shell to xterm, which keeps the selection itself", () => {
		const lab = setup({ mouse: "none" });
		lab.screen.dispatchEvent(rightPress());
		lab.screen.dispatchEvent(hover());
		expect(lab.reachedXterm).toHaveBeenCalledTimes(2);
		expect(lab.onSelectHint).not.toHaveBeenCalled();
		expect(lab.textarea.value).toBe("");
	});

	it("stops intercepting once removed", () => {
		const lab = setup();
		lab.remove();
		lab.screen.dispatchEvent(rightPress());
		expect(lab.reachedXterm).toHaveBeenCalledTimes(1);
	});
});
