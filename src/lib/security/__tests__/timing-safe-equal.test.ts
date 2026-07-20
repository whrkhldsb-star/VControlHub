import { describe, expect, it } from "vitest";

import { timingSafeEqualString } from "@/lib/security/timing-safe-equal";

describe("timingSafeEqualString", () => {
	it("returns true for equal strings", () => {
		expect(timingSafeEqualString("abc123", "abc123")).toBe(true);
		expect(timingSafeEqualString("", "")).toBe(true);
	});

	it("returns false for unequal same-length strings", () => {
		expect(timingSafeEqualString("abc123", "abc124")).toBe(false);
	});

	it("returns false for different lengths without throwing", () => {
		expect(timingSafeEqualString("short", "longer-value")).toBe(false);
	});

	it("returns false for non-string inputs", () => {
		// @ts-expect-error intentional bad input
		expect(timingSafeEqualString(null, "x")).toBe(false);
		// @ts-expect-error intentional bad input
		expect(timingSafeEqualString("x", undefined)).toBe(false);
	});
});
