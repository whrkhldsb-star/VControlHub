import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock, default: { lookup: lookupMock } }));

import { assertPublicBaseUrlResolvesPublic, isUnsafePublicHttpHost, normalizePublicBaseUrl } from "../direct-access-url";

describe("assertPublicBaseUrlResolvesPublic", () => {
	beforeEach(() => vi.clearAllMocks());

	it("accepts hostnames whose DNS answers are public", async () => {
		lookupMock.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
		await expect(assertPublicBaseUrlResolvesPublic("https://cdn.example.com/media")).resolves.toBe("https://cdn.example.com/media");
	});

	it("rejects DNS rebinding to private or metadata networks", async () => {
		lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
		await expect(assertPublicBaseUrlResolvesPublic("https://cdn.example.com/media")).rejects.toThrow("public HTTP(S) address");
	});
});

describe("IPv4-mapped IPv6 host safety", () => {
	it("rejects dotted and hex IPv4-mapped loopback forms", () => {
		expect(isUnsafePublicHttpHost("::ffff:127.0.0.1")).toBe(true);
		expect(isUnsafePublicHttpHost("::ffff:7f00:1")).toBe(true);
		expect(isUnsafePublicHttpHost("[::ffff:127.0.0.1]")).toBe(true);
	});

	it("rejects normalizePublicBaseUrl for mapped loopback", () => {
		expect(() => normalizePublicBaseUrl("https://[::ffff:127.0.0.1]/media")).toThrow();
		expect(() => normalizePublicBaseUrl("https://[::ffff:7f00:1]/media")).toThrow();
	});
});
