import { afterEach, describe, expect, it, vi } from "vitest";

import { copyText } from "../clipboard";

/**
 * The Clipboard API exists only on a secure origin. A console reached by its address over plain HTTP (the
 * installation without a domain) has none, and most "copy" buttons did nothing there.
 */
describe("copyText", () => {
	const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
	const originalExecCommand = (document as { execCommand?: unknown }).execCommand;

	function setClipboard(value: unknown) {
		Object.defineProperty(navigator, "clipboard", { configurable: true, value });
	}

	/** What the browser would put on the clipboard: the text selected in the focused field when "copy" runs. */
	function selectionCopy(result = true) {
		const copied: string[] = [];
		const execCommand = vi.fn((command: string) => {
			const field = document.activeElement;
			if (command === "copy" && field instanceof HTMLTextAreaElement) {
				copied.push(field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0));
			}
			return result;
		});
		(document as { execCommand?: unknown }).execCommand = execCommand;
		return { copied, execCommand };
	}

	afterEach(() => {
		if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
		else delete (navigator as { clipboard?: unknown }).clipboard;
		(document as { execCommand?: unknown }).execCommand = originalExecCommand;
		document.body.replaceChildren();
	});

	it("uses the Clipboard API where the page has one", async () => {
		const writeText = vi.fn(async () => undefined);
		setClipboard({ writeText });
		const { execCommand } = selectionCopy();

		await expect(copyText("https://hub.example/share/abc")).resolves.toBe(true);

		expect(writeText).toHaveBeenCalledWith("https://hub.example/share/abc");
		expect(execCommand).not.toHaveBeenCalled();
	});

	it("copies by selection where there is no Clipboard API (plain HTTP)", async () => {
		setClipboard(undefined);
		const { copied } = selectionCopy();
		const button = document.createElement("button");
		document.body.append(button);
		button.focus();

		await expect(copyText("line one\nline two")).resolves.toBe(true);

		expect(copied).toEqual(["line one\nline two"]);
		// Nothing of the copy is left on the page, and the focus is back where it was.
		expect(document.querySelector("textarea")).toBeNull();
		expect(document.activeElement).toBe(button);
	});

	it("copies by selection when the Clipboard API refuses", async () => {
		setClipboard({ writeText: vi.fn(async () => { throw new DOMException("denied", "NotAllowedError"); }) });
		const { copied } = selectionCopy();

		await expect(copyText("recovery-code-1")).resolves.toBe(true);

		expect(copied).toEqual(["recovery-code-1"]);
	});

	it("puts the field inside the element shown full screen, where the browser still copies", async () => {
		setClipboard(undefined);
		const viewer = document.createElement("div");
		document.body.append(viewer);
		Object.defineProperty(document, "fullscreenElement", { configurable: true, value: viewer });
		const parents: Array<Element | null> = [];
		(document as { execCommand?: unknown }).execCommand = vi.fn(() => {
			parents.push(document.activeElement?.parentElement ?? null);
			return true;
		});
		try {
			await expect(copyText("x")).resolves.toBe(true);
			expect(parents).toEqual([viewer]);
		} finally {
			Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
		}
	});

	it("says so when nothing could copy", async () => {
		setClipboard(undefined);
		selectionCopy(false);
		await expect(copyText("x")).resolves.toBe(false);

		// A browser without the old command either.
		(document as { execCommand?: unknown }).execCommand = undefined;
		await expect(copyText("x")).resolves.toBe(false);
		expect(document.querySelector("textarea")).toBeNull();
	});
});
