import type { Terminal } from "@xterm/xterm";

type MenuTerminal = Pick<Terminal, "element" | "textarea" | "modes" | "hasSelection" | "getSelection">;

/**
 * The browser's right-click Copy while a program reports the mouse (Codex,
 * Claude Code, tmux, vim, htop…).
 *
 * xterm offers selected text to the context menu by moving its hidden
 * textarea under the pointer and selecting the text in it. But with mouse
 * reporting on, xterm also sends that program every pointer move and the
 * right-button press, and anything sent to the program clears the
 * selection: by the time the menu was built it was empty, so Copy stayed
 * greyed out — even after a Shift-drag selection.
 *
 * While text is selected, hover moves and the right press therefore stay in
 * the browser. The selection lasts until the next click, key or wheel step,
 * as in a desktop terminal. A right click with nothing selected still goes
 * to the program (tmux opens its own menu there); `onSelectHint` lets the
 * panel explain how to select instead.
 */
export function installSshTerminalContextMenuCopy(
	term: MenuTerminal,
	surface: HTMLElement,
	onSelectHint: () => void,
): () => void {
	const reporting = () => term.modes.mouseTrackingMode !== "none";

	const onMouseDown = (event: MouseEvent) => {
		if (event.button !== 2 || !reporting()) return;
		if (!term.hasSelection()) {
			onSelectHint();
			return;
		}
		event.stopPropagation();
		event.preventDefault();
		offerSelectionToMenu(term, event);
	};
	const onMouseMove = (event: MouseEvent) => {
		// Only hover: a held button is a drag xterm still has to see.
		if (event.buttons === 0 && reporting() && term.hasSelection()) event.stopPropagation();
	};

	// Capture phase on the host, so this runs before xterm's own listeners.
	surface.addEventListener("mousedown", onMouseDown, true);
	surface.addEventListener("mousemove", onMouseMove, true);
	return () => {
		surface.removeEventListener("mousedown", onMouseDown, true);
		surface.removeEventListener("mousemove", onMouseMove, true);
	};
}

/**
 * What xterm does on a right click, for the press stopped above: Firefox
 * opens its menu from the mousedown, which xterm no longer sees. Chrome and
 * Safari repeat it from xterm's own contextmenu listener, harmlessly.
 */
function offerSelectionToMenu(term: MenuTerminal, event: MouseEvent) {
	const textarea = term.textarea;
	const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
	if (!textarea || !screen) return;
	const box = screen.getBoundingClientRect();
	textarea.style.width = "20px";
	textarea.style.height = "20px";
	textarea.style.left = `${event.clientX - box.left - 10}px`;
	textarea.style.top = `${event.clientY - box.top - 10}px`;
	textarea.style.zIndex = "1000";
	textarea.focus();
	textarea.value = term.getSelection();
	textarea.select();
}
