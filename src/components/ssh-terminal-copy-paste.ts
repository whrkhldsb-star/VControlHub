import type { Terminal } from "@xterm/xterm";

type CopyCapableTerminal = Pick<Terminal, "textarea" | "hasSelection" | "getSelection">;

/**
 * Where the temporary copy textarea may live. In native full screen only the
 * fullscreen element's subtree is interactive; WebKit refuses execCommand
 * copy from a node outside it (e.g. document.body when a container, not the
 * whole document, is full screen).
 */
function copyHost(doc: Document, term: CopyCapableTerminal): Element {
	const full = doc.fullscreenElement ?? (doc as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement ?? null;
	if (!full || full.contains(doc.body)) return doc.body;
	// A fullscreen subtree that does not hold the terminal cannot be the copy target.
	return !term.textarea || full.contains(term.textarea) ? full : doc.body;
}

/** Copy only explicitly selected text. Keep selection, focus and terminal input unchanged. */
async function copySelection(term: CopyCapableTerminal, text: string): Promise<boolean> {
	const doc = term.textarea?.ownerDocument ?? document;
	let copied = false;
	const onCopy = (event: ClipboardEvent) => {
		if (!event.clipboardData) return;
		event.clipboardData.setData("text/plain", text);
		event.preventDefault();
		event.stopImmediatePropagation();
		copied = true;
	};
	// Keep this synchronous inside the user gesture. It also works when the
	// Async Clipboard API is unavailable (HTTP) or permission-restricted.
	// WebKit requires a real DOM selection for execCommand, even though xterm's
	// highlighted selection is virtual. Use a temporary readonly textarea and
	// restore focus synchronously; never clear xterm's selected text.
	const previousFocus = doc.activeElement as HTMLElement | null;
	const textarea = doc.createElement("textarea");
	textarea.value = text;
	textarea.readOnly = true;
	textarea.tabIndex = -1;
	textarea.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
	doc.addEventListener("copy", onCopy, true);
	try {
		copyHost(doc, term).appendChild(textarea);
		textarea.focus({ preventScroll: true });
		textarea.select();
		if (doc.execCommand?.("copy") && copied) return true;
	} catch {
		// Some browsers disable legacy copy. Try the modern API below.
	} finally {
		doc.removeEventListener("copy", onCopy, true);
		textarea.remove();
		if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
	}
	try {
		if (!navigator.clipboard?.writeText) return false;
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

/**
 * Share xterm's one key-handler slot with the IME installer. Returning false
 * only bypasses xterm; it does NOT prevent a browser's default copy/paste.
 *
 * Copy is explicit and cancels the default to avoid two competing writes.
 * Paste stays native: xterm's paste event normalizes newlines, adds bracketed
 * paste markers and emits onData (which still goes through our size guard).
 * Never combine an async readText/term.input with that native paste event.
 */
export function chainSshTerminalCopyPaste(
	term: CopyCapableTerminal,
	next: (event: KeyboardEvent) => boolean,
	onCopyResult?: (copied: boolean) => void,
): (event: KeyboardEvent) => boolean {
	return (event) => {
		if (event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey === event.metaKey) return next(event);
		const key = event.key.toLowerCase();
		if (key === "v") return false; // Let the trusted browser paste event do all work.
		if (key !== "c") return next(event);

		// Bare Ctrl+C without a selection remains the shell's interrupt.
		// Ctrl+Shift+C / Cmd+C must never accidentally become an interrupt.
		if (!term.hasSelection() && !event.shiftKey && !event.metaKey) return next(event);
		event.preventDefault();
		event.stopPropagation();
		if (event.type === "keydown" && !event.repeat && term.hasSelection()) {
			const text = term.getSelection();
			if (text) void copySelection(term, text).then((copied) => onCopyResult?.(copied));
		}
		return false;
	};
}
