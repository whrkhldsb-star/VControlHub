import { describe, expect, it } from "vitest";
import { buildQuickServiceAccessUrl, normalizeQuickServicePublicHost } from "../access-url";

describe("quick service access URLs", () => {
	it("strips protocol and existing ports from configured public host before appending service port", () => {
		expect(normalizeQuickServicePublicHost("https://example.com/")).toBe("example.com");
		expect(buildQuickServiceAccessUrl({ defaultPort: 5244, port: 31000, configuredHost: "https://82.158.91.159:443", browserHost: "whrkhldsb.qzz.io", protocol: "https:" })).toBe("https://82.158.91.159:31000/");
	});

	it("uses the configured public host instead of a proxied dashboard hostname", () => {
		expect(buildQuickServiceAccessUrl({ defaultPort: 5244, port: 5244, configuredHost: "82.158.91.159", browserHost: "whrkhldsb.qzz.io", protocol: "https:" })).toBe("http://82.158.91.159:5244/");
	});

	it("falls back to the browser host when no production host is configured", () => {
		expect(buildQuickServiceAccessUrl({ defaultPort: 8110, port: null, browserHost: "localhost", protocol: "http:" })).toBe("http://localhost:8110/");
	});
});
