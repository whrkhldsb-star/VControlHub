import type { Terminal } from "@xterm/xterm";

/** Mobile IMEs send punctuation as keyCode 229 followed by a native input.
 * xterm's deferred textarea diff can include old text (or run twice when
 * keydowns arrive in a burst). Forward the input event's committed delta.
 * Composition sessions themselves remain owned by xterm.
 */
export function installSshTerminalIme(term: Pick<Terminal, "textarea" | "input" | "attachCustomKeyEventHandler">) {
  const textarea = term.textarea!;
  let composing = false;
  let nativeInput = false;
  term.attachCustomKeyEventHandler(event => {
    if (event.type !== "keydown") return true;
    nativeInput = event.keyCode === 229 && !composing;
    return !nativeInput;
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
