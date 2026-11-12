/**
 * Copies text for a "copy" button and says whether it worked.
 *
 * The Clipboard API exists only on a secure origin (HTTPS or localhost) and can be refused. A console reached
 * by its address over plain HTTP — the installation without a domain — has none, and a button that called it
 * did nothing there. Where it is missing or refuses, the text is copied the older way: selected in a field of
 * its own and copied by the browser, which is allowed inside the click that asked for it.
 *
 * Not for the terminal (it keeps its own selection and focus, see ssh-terminal-copy-paste) nor for the remote
 * desktop's clipboard, which is written without a click.
 */
export async function copyText(text: string): Promise<boolean> {
	if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// Refused (a denied permission, a window without the focus): the selection copy may still work.
		}
	}
	return copyBySelection(text);
}

function copyBySelection(text: string): boolean {
	if (typeof document === "undefined") return false;
	const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	const field = document.createElement("textarea");
	field.value = text;
	field.readOnly = true;
	field.tabIndex = -1;
	field.setAttribute("aria-hidden", "true");
	field.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
	try {
		copyHost().appendChild(field);
		field.focus({ preventScroll: true });
		field.select();
		return document.execCommand("copy");
	} catch {
		// A browser without the command, or one that refuses it outside a click.
		return false;
	} finally {
		field.remove();
		if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
	}
}

/** With one element shown full screen only its own subtree is interactive, and a browser copies only from there. */
function copyHost(): Element {
	const fullscreen = document.fullscreenElement;
	return fullscreen && !fullscreen.contains(document.body) ? fullscreen : document.body;
}
