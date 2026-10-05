import { beforeEach, describe, expect, it, vi } from "vitest";

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: dns.lookup, default: { lookup: dns.lookup } }));

import { resolveDownloadRedirects } from "../redirect-chain";

const PUBLIC: Record<string, string> = {
	"downloads.example.com": "203.0.113.10",
	"cdn.example.net": "203.0.113.20",
	"evil.example.org": "203.0.113.30",
	"metadata.example.org": "169.254.169.254",
};

beforeEach(() => {
	dns.lookup.mockReset().mockImplementation(async (host: string) => {
		const address = PUBLIC[host];
		if (!address) throw new Error("ENOTFOUND");
		return [{ address, family: 4 }];
	});
});

describe("resolveDownloadRedirects", () => {
	it("follows a public redirect chain hop by hop, pinning each validated address", async () => {
		const probe = vi.fn(async (url: string) => (url.includes("downloads.example.com") ? "https://cdn.example.net/file.iso" : null));
		await expect(resolveDownloadRedirects("https://downloads.example.com/latest", { probe })).resolves.toEqual({ ok: true, url: "https://cdn.example.net/file.iso" });
		expect(probe.mock.calls.map(([, resolution]) => resolution.address)).toEqual(["203.0.113.10", "203.0.113.20"]);
	});

	it("refuses a redirect to a link-local, loopback or private address", async () => {
		const toMetadata = vi.fn(async () => "http://169.254.169.254/latest/meta-data/");
		const result = await resolveDownloadRedirects("https://evil.example.org/x", { probe: toMetadata });
		expect(result.ok).toBe(false);
		const viaDns = vi.fn(async () => "http://metadata.example.org/");
		expect((await resolveDownloadRedirects("https://evil.example.org/x", { probe: viaDns })).ok).toBe(false);
		const toLoopback = vi.fn(async () => "http://127.0.0.1:3000/api/admin");
		expect((await resolveDownloadRedirects("https://evil.example.org/x", { probe: toLoopback })).ok).toBe(false);
	});

	it("caps the number of redirects", async () => {
		const loop = vi.fn(async () => "https://downloads.example.com/again");
		await expect(resolveDownloadRedirects("https://downloads.example.com/start", { probe: loop, maxRedirects: 3 })).resolves.toEqual({ ok: false, reason: "Download URL redirects too many times" });
	});

	it("hands the URL over unchanged when the probe cannot reach it (aria2 then refuses redirects)", async () => {
		const failing = vi.fn(async () => { throw new Error("ECONNRESET"); });
		await expect(resolveDownloadRedirects("https://downloads.example.com/file", { probe: failing })).resolves.toEqual({ ok: true, url: "https://downloads.example.com/file" });
	});
});
