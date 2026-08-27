import { describe, expect, it } from "vitest";

import { getSafeNotificationActionUrl } from "./action-url";

describe("getSafeNotificationActionUrl", () => {
	it("falls back to /notifications for empty input", () => {
		expect(getSafeNotificationActionUrl(null)).toBe("/notifications");
		expect(getSafeNotificationActionUrl(undefined)).toBe("/notifications");
		expect(getSafeNotificationActionUrl("")).toBe("/notifications");
		expect(getSafeNotificationActionUrl("   ")).toBe("/notifications");
	});

	it("echoes safe same-origin absolute paths", () => {
		expect(getSafeNotificationActionUrl("/alert-rules?incident=abc")).toBe(
			"/alert-rules?incident=abc",
		);
		expect(getSafeNotificationActionUrl("/notifications")).toBe("/notifications");
		expect(getSafeNotificationActionUrl("  /servers/42  ")).toBe("/servers/42");
		expect(getSafeNotificationActionUrl("/a/b/c#section")).toBe("/a/b/c#section");
	});

	it("rejects protocol-relative URLs", () => {
		expect(getSafeNotificationActionUrl("//evil.com")).toBe("/notifications");
		expect(getSafeNotificationActionUrl("//evil.com/path")).toBe("/notifications");
	});

	it("rejects backslash open-redirect tricks (browsers fold \\ to /)", () => {
		// "/\evil.com" → browser normalizes to "//evil.com" → external host.
		expect(getSafeNotificationActionUrl("/\\evil.com")).toBe("/notifications");
		expect(getSafeNotificationActionUrl("/\\/evil.com")).toBe("/notifications");
		expect(getSafeNotificationActionUrl("\\\\evil.com")).toBe("/notifications");
	});

	it("rejects absolute URLs with an explicit scheme/host", () => {
		expect(getSafeNotificationActionUrl("http://evil.com")).toBe("/notifications");
		expect(getSafeNotificationActionUrl("https://evil.com/x")).toBe("/notifications");
		expect(getSafeNotificationActionUrl("javascript:alert(1)")).toBe("/notifications");
	});

	it("rejects control characters and tabs used to smuggle past naive checks", () => {
		expect(getSafeNotificationActionUrl("/foo\tbar")).toBe("/notifications");
		expect(getSafeNotificationActionUrl("/foo\nbar")).toBe("/notifications");
		expect(getSafeNotificationActionUrl("/\x00evil")).toBe("/notifications");
		expect(getSafeNotificationActionUrl("/foo\x7f")).toBe("/notifications");
	});

	it("rejects values that do not start with a slash", () => {
		expect(getSafeNotificationActionUrl("evil.com")).toBe("/notifications");
		expect(getSafeNotificationActionUrl("relative/path")).toBe("/notifications");
	});
});
