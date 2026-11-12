import { describe, expect, it } from "vitest";

import { BASE_SECURITY_HEADERS, STRICT_TRANSPORT_SECURITY, withBaseSecurityHeaders } from "../security-headers";

describe("withBaseSecurityHeaders", () => {
	it("adds every base header and keeps the response as it was", async () => {
		const response = withBaseSecurityHeaders(
			new Response("body", { status: 207, headers: { DAV: "1", "Content-Type": "application/xml" } }),
			{ https: false },
		);

		for (const [name, value] of BASE_SECURITY_HEADERS) expect(response.headers.get(name)).toBe(value);
		expect(response.status).toBe(207);
		expect(response.headers.get("DAV")).toBe("1");
		expect(response.headers.get("Content-Type")).toBe("application/xml");
		expect(await response.text()).toBe("body");
	});

	it("names the headers the proxy sets", () => {
		expect(BASE_SECURITY_HEADERS.map(([name]) => name)).toEqual([
			"X-Frame-Options",
			"X-Content-Type-Options",
			"X-XSS-Protection",
			"Referrer-Policy",
			"Permissions-Policy",
		]);
	});

	it("keeps a value the route chose and leaves its Content-Security-Policy alone", () => {
		const response = withBaseSecurityHeaders(
			new Response("<p>hi</p>", {
				headers: { "X-Frame-Options": "DENY", "Content-Security-Policy": "sandbox" },
			}),
			{ https: true },
		);

		expect(response.headers.get("X-Frame-Options")).toBe("DENY");
		expect(response.headers.get("Content-Security-Policy")).toBe("sandbox");
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
	});

	it("promises HTTPS only for a request that arrived over it", () => {
		expect(withBaseSecurityHeaders(new Response(null), { https: false }).headers.get("Strict-Transport-Security")).toBeNull();
		expect(withBaseSecurityHeaders(new Response(null), { https: true }).headers.get("Strict-Transport-Security")).toBe(
			STRICT_TRANSPORT_SECURITY,
		);
	});

	it("keeps every Set-Cookie of the response", () => {
		const source = new Response(null);
		source.headers.append("Set-Cookie", "a=1; Path=/");
		source.headers.append("Set-Cookie", "b=2; Path=/");

		expect(withBaseSecurityHeaders(source, { https: false }).headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
	});

	it("copies a response whose headers cannot be changed", () => {
		// Response.redirect() hands out immutable headers.
		const redirect = Response.redirect("http://hub.example/login", 307);
		expect(() => redirect.headers.set("X-Test", "1")).toThrow();

		const response = withBaseSecurityHeaders(redirect, { https: true });

		expect(response.status).toBe(307);
		expect(response.headers.get("Location")).toBe("http://hub.example/login");
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(response.headers.get("Strict-Transport-Security")).toBe(STRICT_TRANSPORT_SECURITY);
	});
});
