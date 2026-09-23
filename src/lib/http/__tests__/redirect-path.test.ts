import { describe, expect, it } from "vitest";

import { safeRelativeRedirectPath } from "../redirect-path";

describe("safeRelativeRedirectPath", () => {
	it("accepts ordinary same-origin relative paths", () => {
		expect(safeRelativeRedirectPath("/servers")).toBe("/servers");
		expect(safeRelativeRedirectPath("/login?next=/x")).toBe("/login?next=/x");
		expect(safeRelativeRedirectPath(" /dashboard ")).toBe("/dashboard");
	});

	it("falls back for absolute and protocol-relative URLs", () => {
		expect(safeRelativeRedirectPath("https://evil.example.com")).toBe("/");
		expect(safeRelativeRedirectPath("//evil.example.com")).toBe("/");
		expect(safeRelativeRedirectPath("http://evil.example.com")).toBe("/");
		expect(safeRelativeRedirectPath("javascript:alert(1)")).toBe("/");
		expect(safeRelativeRedirectPath("")).toBe("/");
		expect(safeRelativeRedirectPath(null)).toBe("/");
		expect(safeRelativeRedirectPath(undefined)).toBe("/");
	});

	it("rejects the backslash protocol-relative form", () => {
		// WHATWG URL normalizes `\` to `/`: a Location of /\evil.com is parsed
		// by browsers as //evil.com — an open redirect despite passing the
		// classic startsWith("/") && !startsWith("//") check.
		expect(safeRelativeRedirectPath("/\\evil.example.com")).toBe("/");
		expect(safeRelativeRedirectPath("\\/evil.example.com")).toBe("/");
	});

	it("rejects control characters that could smuggle header tricks", () => {
		expect(safeRelativeRedirectPath("/ok\r\nSet-Cookie: x=1")).toBe("/");
		expect(safeRelativeRedirectPath("/ok\u0000")).toBe("/");
	});

	it("honours a custom fallback", () => {
		expect(safeRelativeRedirectPath("//evil.example.com", "/dashboard")).toBe("/dashboard");
	});
});
