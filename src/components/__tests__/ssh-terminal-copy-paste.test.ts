import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainSshTerminalCopyPaste } from "../ssh-terminal-copy-paste";

const ctrlEvent = (key: string, opts: Partial<KeyboardEventInit> = {}) =>
	new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true, ...opts });

function makeTerm(selection = "") {
	return {
		selection,
		hasSelection: () => selection.length > 0,
		getSelection: () => selection,
		clearSelection: vi.fn(function (this: { selection: string }) {
			this.selection = "";
		}),
		input: vi.fn(),
	};
}

describe("ssh terminal copy/paste chaining", () => {
	let writeText: ReturnType<typeof vi.fn>;
	let readText: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		writeText = vi.fn().mockResolvedValue(undefined);
		readText = vi.fn().mockResolvedValue("");
		vi.stubGlobal("navigator", { clipboard: { writeText, readText } });
	});

	it("Ctrl+C with a selection copies and does not reach the shell", () => {
		const term = makeTerm("echo hello");
		const next = vi.fn((_: KeyboardEvent) => true);
		const handler = chainSshTerminalCopyPaste(term as never, next);

		expect(handler(ctrlEvent("c"))).toBe(false);
		expect(writeText).toHaveBeenCalledWith("echo hello");
		expect(next).not.toHaveBeenCalled();
	});

	it("Ctrl+C without a selection falls through so the shell receives ^C", () => {
		const term = makeTerm("");
		const next = vi.fn((_: KeyboardEvent) => true);
		const handler = chainSshTerminalCopyPaste(term as never, next);

		expect(handler(ctrlEvent("c"))).toBe(true);
		expect(writeText).not.toHaveBeenCalled();
		expect(next).toHaveBeenCalledOnce();
	});

	it("clipboard write failure is swallowed and the key is still claimed", () => {
		writeText.mockRejectedValue(new Error("denied"));
		const term = makeTerm("secret");
		const next = vi.fn((_: KeyboardEvent) => true);
		const handler = chainSshTerminalCopyPaste(term as never, next);

		expect(handler(ctrlEvent("c"))).toBe(false);
		expect(next).not.toHaveBeenCalled();
	});

	it("Cmd+C on macOS copies a selection", () => {
		const term = makeTerm("ls -la");
		const next = vi.fn((_: KeyboardEvent) => true);
		const handler = chainSshTerminalCopyPaste(term as never, next);
		const cmdC = new KeyboardEvent("keydown", { key: "c", metaKey: true, cancelable: true });

		expect(handler(cmdC)).toBe(false);
		expect(writeText).toHaveBeenCalledWith("ls -la");
	});

	it("Ctrl+Shift+C (terminal-standard interrupt) is NOT treated as copy", () => {
		const term = makeTerm("vim");
		const next = vi.fn((_: KeyboardEvent) => true);
		const handler = chainSshTerminalCopyPaste(term as never, next);
		const chord = ctrlEvent("c", { shiftKey: true });

		expect(handler(chord)).toBe(true);
		expect(writeText).not.toHaveBeenCalled();
	});

	it("Ctrl+V pastes clipboard text through term.input", () => {
		readText.mockResolvedValue("systemctl status nginx");
		const term = makeTerm("");
		const next = vi.fn((_: KeyboardEvent) => true);
		const handler = chainSshTerminalCopyPaste(term as never, next);

		expect(handler(ctrlEvent("v"))).toBe(false);
		expect(next).not.toHaveBeenCalled();
		// readText is async; flush microtasks before asserting the input call.
		return vi.waitFor(() => {
			expect(term.input).toHaveBeenCalledWith("systemctl status nginx", true);
		});
	});

	it("non-copy/paste keys pass through untouched", () => {
		const term = makeTerm("selected");
		const next = vi.fn((_: KeyboardEvent) => true);
		const handler = chainSshTerminalCopyPaste(term as never, next);

		expect(handler(ctrlEvent("l"))).toBe(true);
		expect(handler(new KeyboardEvent("keydown", { key: "a" }))).toBe(true);
		expect(handler(new KeyboardEvent("keyup", { key: "c", ctrlKey: true }))).toBe(true);
		expect(writeText).not.toHaveBeenCalled();
		expect(readText).not.toHaveBeenCalled();
		expect(next).toHaveBeenCalledTimes(3);
	});
});
