import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chainSshTerminalCopyPaste } from "../ssh-terminal-copy-paste";

const key = (value: string, options: KeyboardEventInit = {}) =>
	new KeyboardEvent("keydown", { key: value, ctrlKey: true, cancelable: true, ...options });

function setup(selection = "hello") {
	const textarea = document.createElement("textarea");
	const term = {
		textarea, hasSelection: () => selection.length > 0, getSelection: () => selection,
		clearSelection: vi.fn(), input: vi.fn(), attachCustomKeyEventHandler: vi.fn(),
	};
	const next = vi.fn((_event: KeyboardEvent) => true);
	const report = vi.fn();
	return { term, next, report, handler: chainSshTerminalCopyPaste(term, next, report) };
}

describe("SSH terminal clipboard shortcuts", () => {
	let writeText: ReturnType<typeof vi.fn>;
	let readText: ReturnType<typeof vi.fn>;
	beforeEach(() => {
		writeText = vi.fn().mockResolvedValue(undefined);
		readText = vi.fn().mockResolvedValue("do not inject this");
		vi.stubGlobal("navigator", { clipboard: { writeText, readText } });
		Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
	});
	afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete (document as Partial<Document>).execCommand; });

	it.each([{ ctrlKey: true }, { ctrlKey: false, metaKey: true }, { ctrlKey: true, shiftKey: true }])("copies selected text for %j and prevents the browser default", async (modifiers) => {
		const { handler, next, term, report } = setup("中文\nhello");
		const event = key("c", modifiers);
		expect(handler(event)).toBe(false);
		expect(event.defaultPrevented).toBe(true);
		await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("中文\nhello"));
		expect(next).not.toHaveBeenCalled();
		expect(term.input).not.toHaveBeenCalled();
		expect(term.clearSelection).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(report).toHaveBeenCalledWith(true));
	});

	it("leaves unselected Ctrl+C as an interrupt", () => {
		const { handler, next } = setup("");
		expect(handler(key("c"))).toBe(true);
		expect(next).toHaveBeenCalledOnce();
	});

	it("never turns unselected Ctrl+Shift+C into an interrupt", () => {
		const { handler, next } = setup("");
		const event = key("C", { shiftKey: true });
		expect(handler(event)).toBe(false);
		expect(event.defaultPrevented).toBe(true);
		expect(next).not.toHaveBeenCalled();
		expect(writeText).not.toHaveBeenCalled();
	});

	it.each([{ ctrlKey: true }, { ctrlKey: false, metaKey: true }, { ctrlKey: true, shiftKey: true }])("leaves paste to the native event once for %j", async (modifiers) => {
		const { handler, term } = setup();
		const event = key("v", modifiers);
		expect(handler(event)).toBe(false);
		expect(event.defaultPrevented).toBe(false);
		await Promise.resolve();
		expect(readText).not.toHaveBeenCalled();
		expect(term.input).not.toHaveBeenCalled();
	});

	it("uses synchronous copy events without needing Async Clipboard API", async () => {
		vi.stubGlobal("navigator", {});
		const data = { setData: vi.fn() };
		vi.spyOn(document, "execCommand").mockImplementation(() => {
			const event = new Event("copy", { cancelable: true });
			Object.defineProperty(event, "clipboardData", { value: data });
			document.dispatchEvent(event);
			return event.defaultPrevented;
		});
		const { handler, report } = setup();
		expect(() => handler(key("c"))).not.toThrow();
		await vi.waitFor(() => expect(report).toHaveBeenCalledWith(true));
		expect(data.setData).toHaveBeenCalledWith("text/plain", "hello");
		data.setData.mockClear();
		document.dispatchEvent(new Event("copy"));
		expect(data.setData).not.toHaveBeenCalled();
	});

	it.each([
		{ name: "a fullscreen container holding the terminal", fullscreen: "container", host: "container" },
		{ name: "the document element", fullscreen: "root", host: "body" },
		{ name: "an unrelated fullscreen element", fullscreen: "other", host: "body" },
		{ name: "no full screen", fullscreen: null, host: "body" },
	])("mounts the legacy copy helper for $name", async ({ fullscreen, host }) => {
		vi.stubGlobal("navigator", {});
		const container = document.createElement("div");
		const other = document.createElement("div");
		document.body.append(container, other);
		const { term, handler, report } = setup();
		container.appendChild(term.textarea);
		const full = { container, root: document.documentElement, other, none: null }[fullscreen ?? "none"];
		Object.defineProperty(document, "fullscreenElement", { configurable: true, value: full });
		let parent: Element | null = null;
		vi.spyOn(document, "execCommand").mockImplementation(() => {
			parent = (document.activeElement as HTMLElement).parentElement;
			return false;
		});
		try {
			handler(key("c"));
			await vi.waitFor(() => expect(report).toHaveBeenCalledWith(false));
			expect(parent).toBe(host === "container" ? container : document.body);
			expect(container.querySelector("textarea[readonly]")).toBeNull();
		} finally {
			delete (document as { fullscreenElement?: unknown }).fullscreenElement;
			container.remove();
			other.remove();
		}
	});

	it("reports denied clipboard access without clearing selection or sending input", async () => {
		writeText.mockRejectedValue(new Error("denied"));
		const { handler, term, report } = setup();
		handler(key("c"));
		await vi.waitFor(() => expect(report).toHaveBeenCalledWith(false));
		expect(term.clearSelection).not.toHaveBeenCalled();
		expect(term.input).not.toHaveBeenCalled();
	});

	it("reports unavailable APIs rather than throwing or silently succeeding", async () => {
		vi.stubGlobal("navigator", {});
		vi.spyOn(document, "execCommand").mockImplementation(() => { throw new Error("blocked"); });
		const { handler, report } = setup();
		expect(() => handler(key("c"))).not.toThrow();
		await vi.waitFor(() => expect(report).toHaveBeenCalledWith(false));
	});

	it("does not write again on key repeat, keyup, or keypress", () => {
		const { handler } = setup();
		for (const event of [key("c", { repeat: true }), new KeyboardEvent("keyup", { key: "c", ctrlKey: true }), new KeyboardEvent("keypress", { key: "c", ctrlKey: true })]) {
			expect(handler(event)).toBe(false);
		}
		expect(writeText).not.toHaveBeenCalled();
	});

	it("preserves AltGr, composition, unrelated keys and delegate results", () => {
		const { handler, next } = setup();
		for (const event of [key("c", { altKey: true }), key("v", { isComposing: true }), key("l"), key("c", { ctrlKey: false })]) {
			expect(handler(event)).toBe(true);
		}
		next.mockReturnValue(false);
		expect(handler(key("x"))).toBe(false);
		expect(writeText).not.toHaveBeenCalled();
		expect(readText).not.toHaveBeenCalled();
	});
});
