import { describe, expect, it } from "vitest";

import { getCsrfCookieName } from "../csrf";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, csrfTokensMatch, requestPassesCsrfCheck } from "../csrf-request";

const TOKEN = "ab".repeat(32);

function request(headers: Record<string, string>) {
	return new Request("http://hub.test/api/servers/s1/sftp/upload", { method: "POST", headers });
}

describe("double-submit CSRF comparison", () => {
	it("uses the cookie the login routes set", () => {
		expect(CSRF_COOKIE_NAME).toBe(getCsrfCookieName());
		expect(CSRF_HEADER_NAME).toBe("x-csrf-token");
	});

	it("needs both values, equal", () => {
		expect(csrfTokensMatch(TOKEN, TOKEN)).toBe(true);
		expect(csrfTokensMatch(TOKEN, `${TOKEN.slice(0, -1)}0`)).toBe(false);
		expect(csrfTokensMatch(TOKEN, TOKEN.slice(0, -2))).toBe(false);
		expect(csrfTokensMatch(TOKEN, null)).toBe(false);
		expect(csrfTokensMatch(undefined, TOKEN)).toBe(false);
		expect(csrfTokensMatch("", "")).toBe(false);
	});

	it("passes a request whose header repeats its csrf cookie", () => {
		expect(requestPassesCsrfCheck(request({ cookie: `vcontrolhub_session=a.b; csrf_token=${TOKEN}`, "x-csrf-token": TOKEN }))).toBe(true);
		expect(requestPassesCsrfCheck(request({ cookie: `csrf_token=${TOKEN}; theme=dark`, "x-csrf-token": TOKEN }))).toBe(true);
	});

	it.each([
		["no cookie and no header", {}],
		["the cookie alone, as a cross-site form post sends it", { cookie: `csrf_token=${TOKEN}` }],
		["the header alone", { "x-csrf-token": TOKEN }],
		["a header that differs", { cookie: `csrf_token=${TOKEN}`, "x-csrf-token": "cd".repeat(32) }],
		["a cookie whose name merely ends the same", { cookie: `not_csrf_token=${TOKEN}`, "x-csrf-token": TOKEN }],
		["an empty cookie value", { cookie: "csrf_token=", "x-csrf-token": "" }],
	])("refuses %s", (_case, headers) => {
		expect(requestPassesCsrfCheck(request(headers))).toBe(false);
	});
});
