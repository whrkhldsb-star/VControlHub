import { afterEach, describe, expect, it, vi } from "vitest";

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

	describe("X-Forwarded-Host", () => {
		afterEach(() => vi.unstubAllEnvs());
		const proxied = (origin: string) => formRequest({ host: "127.0.0.1:3000", "x-forwarded-host": "console.example.com", origin });

		it("anchors the comparison behind a trusted reverse proxy (the default single hop)", () => {
			expect(isCrossSiteFormPost(proxied("https://console.example.com"))).toBe(false);
			expect(isCrossSiteFormPost(proxied("https://attacker.example"))).toBe(true);
		});

		it("is ignored when no proxy is trusted, so a cross-site page cannot name its own host in it", () => {
			vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
			expect(isCrossSiteFormPost(formRequest({ "x-forwarded-host": "attacker.example", origin: "https://attacker.example" }))).toBe(true);
			expect(isCrossSiteFormPost(formRequest({ "x-forwarded-host": "attacker.example", origin: "https://console.example.com" }))).toBe(false);
		});
	});
});
