import { describe, expect, it } from "vitest";

import { isCrossSiteFormPost } from "../request-origin";

function formRequest(headers: Record<string, string> = {}) {
	return new Request("https://console.example.com/api/login", {
		method: "POST",
		headers: { host: "console.example.com", ...headers },
	});
}

describe("pre-session form origin guard", () => {
	it("accepts a same-origin browser post and a headerless API client", () => {
		expect(isCrossSiteFormPost(formRequest({
			"sec-fetch-site": "same-origin",
			origin: "https://console.example.com",
		}))).toBe(false);
		expect(isCrossSiteFormPost(formRequest())).toBe(false);
	});

	it("rejects a sibling subdomain even when the browser reports same-site", () => {
		expect(isCrossSiteFormPost(formRequest({
			"sec-fetch-site": "same-site",
			origin: "https://uploads.example.com",
		}))).toBe(true);
	});

	it("rejects cross-site, opaque, and malformed origins", () => {
		expect(isCrossSiteFormPost(formRequest({ "sec-fetch-site": "cross-site" }))).toBe(true);
		expect(isCrossSiteFormPost(formRequest({ origin: "null" }))).toBe(true);
		expect(isCrossSiteFormPost(formRequest({ origin: "not-a-url" }))).toBe(true);
	});
});
