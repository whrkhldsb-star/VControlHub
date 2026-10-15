import type { Terminal } from "@xterm/xterm";

/**
 * Custom key handler chain protocol shared by terminal add-on installers.
 * xterm exposes a single `attachCustomKeyEventHandler` slot; modules that need
 * it (IME forwarding, copy/paste) agree to wrap `next` and call it for every
 * event they do not claim, instead of replacing it.
 */
export type SshTerminalKeyHandler = (event: KeyboardEvent) => boolean;

/**
 * Mobile IMEs send punctuation as keyCode 229 followed by a native input.
 * xterm's deferred textarea diff can include old text (or run twice when
 * keydowns arrive in a burst). Forward the input event's committed delta.
 * Composition sessions themselves remain owned by xterm.
 */
export function installSshTerminalIme(
  term: Pick<Terminal, "textarea" | "input" | "attachCustomKeyEventHandler">,
  next?: SshTerminalKeyHandler,
) {
  const textarea = term.textarea!;
  let composing = false;
  let nativeInput = false;
  term.attachCustomKeyEventHandler(event => {
    if (event.type !== "keydown") return next ? next(event) : true;
    nativeInput = event.keyCode === 229 && !composing;
    if (nativeInput) return false;
    return next ? next(event) : true;
  });
  const start = () => { composing = true; nativeInput = false; };
  const end = () => { composing = false; nativeInput = false; };
  const input = (event: Event) => {
    const ev = event as InputEvent;
    if (!nativeInput || composing || ev.isComposing) return;
    nativeInput = false;
    let data: string;
    if (ev.inputType === "insertText") data = ev.data ?? "";
    else if (ev.inputType === "deleteContentBackward") data = "\x7f";
    else return;
    // Registered on the parent in capture phase, before xterm's textarea
    // listener. Never run both input paths for the same native event.
    ev.stopImmediatePropagation();
    term.input(data, true);
  };
  const parent = textarea.parentElement!;
  parent.addEventListener("input", input, true);
  textarea.addEventListener("compositionstart", start);
  textarea.addEventListener("compositionend", end);
  return () => {
    parent.removeEventListener("input", input, true);
    textarea.removeEventListener("compositionstart", start);
    textarea.removeEventListener("compositionend", end);
  };
}
