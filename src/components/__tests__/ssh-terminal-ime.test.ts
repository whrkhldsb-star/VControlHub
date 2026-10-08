import { expect, it, vi } from "vitest";
import { installSshTerminalIme } from "../ssh-terminal-ime";

it("sends only native IME punctuation deltas, including bursts and replacement of retained text", () => {
  const parent = document.createElement("div");
  const textarea = document.createElement("textarea");
  parent.append(textarea);
  let keydown: (event: KeyboardEvent) => boolean;
  const input = vi.fn();
  const remove = installSshTerminalIme({ textarea, input, attachCustomKeyEventHandler: handler => { keydown = handler; } });
  const xtermInput = vi.fn();
  textarea.addEventListener("input", xtermInput, true);
  textarea.value = "previous command";
  for (const data of ["（", "）", "[", "]", "，", " "]) {
    expect(keydown!(new KeyboardEvent("keydown", { keyCode: 229 }))).toBe(false);
    textarea.value = `previous command${data}`;
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data }));
  }
  expect(input.mock.calls.map(call => call[0]).join("")).toBe("（）[]， ");
  expect(xtermInput).not.toHaveBeenCalled();
  expect(keydown!(new KeyboardEvent("keydown", { key: "a", keyCode: 65 }))).toBe(true);
  textarea.dispatchEvent(new CompositionEvent("compositionstart"));
  expect(keydown!(new KeyboardEvent("keydown", { keyCode: 229 }))).toBe(true);
  textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "中文", isComposing: true }));
  expect(xtermInput).toHaveBeenCalledTimes(1);
  textarea.dispatchEvent(new CompositionEvent("compositionend"));
  remove();
});
