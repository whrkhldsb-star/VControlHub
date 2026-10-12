import { beforeEach, describe, expect, it, vi } from "vitest";

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: dns.lookup, default: { lookup: dns.lookup } }));

import { pinHttpSourceForAria2, resolveDownloadRedirects } from "../redirect-chain";
import type { DownloadSourceResolution } from "../source-url";

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
		const probe = vi.fn(async (url: string, _resolution: DownloadSourceResolution) => (url.includes("downloads.example.com") ? "https://cdn.example.net/file.iso" : null));
		await expect(resolveDownloadRedirects("https://downloads.example.com/latest", { probe })).resolves.toEqual({
			ok: true,
			url: "https://cdn.example.net/file.iso",
			resolution: { hostname: "cdn.example.net", address: "203.0.113.20", port: 443 },
		});
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
		await expect(resolveDownloadRedirects("https://downloads.example.com/file", { probe: failing })).resolves.toMatchObject({ ok: true, url: "https://downloads.example.com/file" });
	});
});

describe("pinHttpSourceForAria2", () => {
	it("hands aria2 the validated address for plain http and keeps the name in a Host header", () => {
		expect(pinHttpSourceForAria2("http://downloads.example.com/a/b.iso?x=1", { hostname: "downloads.example.com", address: "203.0.113.10", port: 80 })).toEqual({
			uri: "http://203.0.113.10/a/b.iso?x=1",
			options: { header: "Host: downloads.example.com" },
		});
		expect(pinHttpSourceForAria2("http://v6.example.com/f", { hostname: "v6.example.com", address: "2001:db8::10", port: 80 }).uri).toBe("http://[2001:db8::10]/f");
	});

	it("leaves https, IP-literal and unresolved sources untouched", () => {
		expect(pinHttpSourceForAria2("https://cdn.example.net/file.iso", { hostname: "cdn.example.net", address: "203.0.113.20", port: 443 })).toEqual({ uri: "https://cdn.example.net/file.iso", options: {} });
		expect(pinHttpSourceForAria2("http://203.0.113.10/file", { hostname: "203.0.113.10", address: "203.0.113.10", port: 80 })).toEqual({ uri: "http://203.0.113.10/file", options: {} });
		expect(pinHttpSourceForAria2("magnet:?xt=urn:btih:abc", undefined)).toEqual({ uri: "magnet:?xt=urn:btih:abc", options: {} });
	});
});
