import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSoftKeyboard, keyboardShowing } from "../rdp-soft-keyboard";

/**
 * The on-screen keyboard of a remote desktop: raised by its button only, lowered by the same button, and
 * noticed when the system lowers it.
 */
describe("keyboardShowing", () => {
	it("sees a keyboard that shrinks the visual viewport (iOS, Android by default)", () => {
		expect(keyboardShowing({ innerHeight: 800, visualHeight: 480, baselineHeight: 800 })).toBe(true);
		expect(keyboardShowing({ innerHeight: 800, visualHeight: 760, baselineHeight: 800 })).toBe(false);
	});

	it("sees a keyboard that shrinks the page itself (interactive-widget=resizes-content)", () => {
		expect(keyboardShowing({ innerHeight: 500, visualHeight: 500, baselineHeight: 800 })).toBe(true);
		expect(keyboardShowing({ innerHeight: 790, visualHeight: 790, baselineHeight: 800 })).toBe(false);
	});

	it("works without the Visual Viewport API", () => {
		expect(keyboardShowing({ innerHeight: 500, visualHeight: null, baselineHeight: 800 })).toBe(true);
		expect(keyboardShowing({ innerHeight: 800, visualHeight: null, baselineHeight: 800 })).toBe(false);
	});
});

describe("soft keyboard controller", () => {
	let input: HTMLTextAreaElement;
	let surface: HTMLDivElement;
	let win: { innerWidth: number; innerHeight: number; visualViewport: { height: number; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> } | undefined; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn>; document: Document };
	const resizeHandlers: Array<() => void> = [];
	const resize = () => resizeHandlers.forEach(handler => handler());

	beforeEach(() => {
		resizeHandlers.length = 0;
		surface = document.createElement("div");
		surface.tabIndex = 0;
		input = document.createElement("textarea");
		surface.appendChild(input);
		document.body.appendChild(surface);
		win = {
			innerWidth: 390,
			innerHeight: 800,
			visualViewport: {
				height: 800,
				addEventListener: vi.fn((_type: string, handler: () => void) => resizeHandlers.push(handler)),
				removeEventListener: vi.fn(),
			},
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			document,
		};
	});
	afterEach(() => { surface.remove(); });

	const create = (onChange = vi.fn()) => ({ onChange, keyboard: createSoftKeyboard({ input, surface, onChange, win: win as unknown as Window }) });

	it("keeps the field from raising a keyboard just by having the focus", () => {
		create();
		expect(input.inputMode).toBe("none");
		input.focus();
		expect(document.activeElement).toBe(input);
		expect(input.inputMode).toBe("none");
	});

	it("raises the keyboard on open and lowers it on the second tap of the button", () => {
		const { keyboard, onChange } = create();
		keyboard.toggle();
		expect(keyboard.isOpen()).toBe(true);
		expect(input.inputMode).toBe("text");
		expect(document.activeElement).toBe(input);
		expect(onChange).toHaveBeenLastCalledWith(true);

		keyboard.toggle();
		expect(keyboard.isOpen()).toBe(false);
		expect(input.inputMode).toBe("none");
		// Hardware keys still reach the desktop, whose element keeps the focus.
		expect(document.activeElement).toBe(surface);
		expect(onChange).toHaveBeenLastCalledWith(false);
		expect(onChange).toHaveBeenCalledTimes(2);
	});

	it("takes the focus off a field that kept it after the system hid the keyboard, so the keyboard returns", () => {
		const { keyboard } = create();
		input.focus();
		const blur = vi.spyOn(input, "blur");
		const focus = vi.spyOn(input, "focus");
		keyboard.open();
		expect(blur).toHaveBeenCalledTimes(1);
		expect(focus).toHaveBeenCalledTimes(1);
	});

	it("closes when the system lowers the keyboard (its own hide key or the back gesture)", () => {
		const { keyboard, onChange } = create();
		keyboard.open();
		// The keyboard comes up: the page shrinks.
		win.innerHeight = 480;
		win.visualViewport!.height = 480;
		resize();
		expect(keyboard.isOpen()).toBe(true);
		// The system hides it again.
		win.innerHeight = 800;
		win.visualViewport!.height = 800;
		resize();
		expect(keyboard.isOpen()).toBe(false);
		expect(onChange).toHaveBeenLastCalledWith(false);
		expect(document.activeElement).toBe(surface);
	});

	it("stays open when no keyboard ever appears (a hardware keyboard), for the extra keys", () => {
		const { keyboard } = create();
		keyboard.open();
		win.innerHeight = 801;
		resize();
		resize();
		expect(keyboard.isOpen()).toBe(true);
	});

	it("closes when the device is rotated", () => {
		const { keyboard } = create();
		keyboard.open();
		win.innerWidth = 844;
		win.innerHeight = 390;
		resize();
		expect(keyboard.isOpen()).toBe(false);
	});

	it("learns the page's height while no keyboard is up, so a later shrink counts as a keyboard", () => {
		const { keyboard } = create();
		win.innerHeight = 860;
		resize();
		keyboard.open();
		win.innerHeight = 520;
		win.visualViewport!.height = 520;
		resize();
		win.innerHeight = 860;
		win.visualViewport!.height = 860;
		resize();
		expect(keyboard.isOpen()).toBe(false);
	});

	it("lowers the keyboard and stops listening when the desktop goes away", () => {
		const { keyboard } = create();
		keyboard.open();
		keyboard.dispose();
		expect(input.inputMode).toBe("none");
		expect(document.activeElement).not.toBe(input);
		expect(win.removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
	});
});
