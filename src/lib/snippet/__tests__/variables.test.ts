import { describe, expect, it } from "vitest";
import {
  extractSnippetVariables,
  insertSnippetAtSelection,
  MAX_COMMAND_BODY_LENGTH,
  substituteSnippetVariables,
} from "../variables";

describe("snippet variable & insertion helpers", () => {
  it("extracts distinct variables in first-seen order and substitutes them", () => {
    const content = "journalctl -u {{service}} -n {{lines}} && systemctl status {{ service }}";
    expect(extractSnippetVariables(content)).toEqual(["service", "lines"]);
    expect(substituteSnippetVariables(content, { service: "nginx", lines: "100" })).toBe(
      "journalctl -u nginx -n 100 && systemctl status nginx",
    );
  });

  it("inserts at selection without truncating when exceeding maxLength", () => {
    const ok = insertSnippetAtSelection({
      currentValue: "echo start\necho end",
      snippetText: "uptime\n",
      selectionStart: 11,
      selectionEnd: 11,
    });
    expect(ok).toEqual({
      ok: true,
      nextValue: "echo start\nuptime\necho end",
      nextCursor: 18,
    });

    const tooLong = insertSnippetAtSelection({
      currentValue: "a".repeat(9_990),
      snippetText: "b".repeat(50),
      maxLength: MAX_COMMAND_BODY_LENGTH,
    });
    expect(tooLong).toEqual({
      ok: false,
      resultingLength: 10_040,
      maxLength: 10_000,
    });
  });
});
