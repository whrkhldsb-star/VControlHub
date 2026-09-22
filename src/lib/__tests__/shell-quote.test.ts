import { describe, expect, it } from "vitest";
import { shellQuote } from "../shell-quote";

describe("shellQuote", () => {
	it("wraps plain values in single quotes", () => {
		expect(shellQuote("hello")).toBe("'hello'");
	});

	it("round-trips values containing single quotes without breaking out of the quoting", () => {
		const hostile = "a'; rm -rf /; echo '";
		const quoted = shellQuote(hostile);
		// Semantic round-trip: strip the outer quotes and undo the '\'' escapes.
		expect(quoted.startsWith("'")).toBe(true);
		expect(quoted.endsWith("'")).toBe(true);
		expect(quoted.slice(1, -1).split(`'\\''`).join("'")).toBe(hostile);
		// The escape idiom is the POSIX standard '\'' (not '"'"' or other variants).
		expect(quoted).toContain(`'\\''`);
	});

	it("neutralizes command-substitution and metacharacters inside quotes", () => {
		expect(shellQuote("$(whoami)")).toBe("'$(whoami)'");
		expect(shellQuote("a b`c`")).toBe("'a b`c`'");
	});

	it("stringifies numbers so ports and ids can be passed directly", () => {
		expect(shellQuote(22)).toBe("'22'");
		expect(shellQuote(0)).toBe("'0'");
	});

	it("keeps an empty string a quoted empty string (not an unquoted token)", () => {
		expect(shellQuote("")).toBe("''");
	});
});
