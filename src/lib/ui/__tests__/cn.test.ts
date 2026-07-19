import { describe, expect, it } from "vitest";

import { cn } from "@/lib/ui/cn";
import {
	UI_BTN_PRIMARY,
	UI_BTN_SUCCESS,
	UI_INPUT,
	UI_TONE,
} from "@/lib/ui/classes";

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
	it("uses design tokens instead of hard-coded white/black", () => {
		expect(UI_BTN_PRIMARY).toContain("var(--color-action)");
		expect(UI_BTN_PRIMARY).toContain("var(--color-action-fg)");
		expect(UI_BTN_PRIMARY).not.toMatch(/text-white|border-white|bg-black/);
		expect(UI_BTN_SUCCESS).toContain("var(--success)");
		expect(UI_INPUT).toContain("var(--input-bg)");
		expect(UI_INPUT).toContain("var(--input-border)");
		expect(UI_INPUT).toContain("placeholder:text-[var(--text-muted)]");
		expect(UI_TONE.danger).toContain("var(--danger-bg)");
	});
});
