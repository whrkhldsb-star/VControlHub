import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { cn } from "@/lib/ui/cn";
import { UI_INPUT, UI_LABEL, UI_TONE } from "@/lib/ui/classes";

describe("cn", () => {
	it("joins truthy class names", () => {
		expect(cn("a", "b", "c")).toBe("a b c");
	});

	it("drops falsy values", () => {
		expect(cn("a", false, null, undefined, "b")).toBe("a b");
	});

	it("flattens nested arrays", () => {
		expect(cn("a", ["b", false, "c"], "d")).toBe("a b c d");
	});

	it("keeps 0 as a class token", () => {
		expect(cn("a", 0, "b")).toBe("a 0 b");
	});
});

describe("ui classes", () => {
	it("defines field chrome once, in the components layer of globals.css", () => {
		const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
		const components = css.slice(css.indexOf("@layer components"));
		const rule = /\.ui-control \{([^}]*)\}/.exec(components)?.[1] ?? "";
		for (const token of ["var(--input-border)", "var(--input-bg)", "var(--control-height)", "var(--radius-control)"]) {
			expect(rule).toContain(token);
		}
		expect(components).toContain(".ui-control::placeholder");
		expect(components).toContain(".ui-control:focus");
		expect(components).toContain(".ui-control:disabled");
		const label = /\.ui-label \{([^}]*)\}/.exec(components)?.[1] ?? "";
		expect(label).toContain("var(--text-primary)");
	});

	it("uses design tokens instead of hard-coded white/black", () => {
		for (const fragment of [UI_INPUT, UI_LABEL, ...Object.values(UI_TONE)]) {
			expect(fragment).not.toMatch(/text-white|border-white|bg-black|bg-white/);
		}
		expect(UI_LABEL).toBe("ui-label");
		expect(UI_INPUT).toBe("ui-control");
		expect(UI_TONE.danger).toContain("var(--danger-bg)");
	});
});
