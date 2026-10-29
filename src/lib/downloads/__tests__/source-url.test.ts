import { describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
}));

import { assertDownloadSourceUrlSafe, sanitizeMagnetLink, validateDownloadSourceUrl } from "@/lib/downloads/source-url";

vi.mock("node:dns/promises", () => ({
  default: { lookup: lookupMock },
  lookup: lookupMock,
}));

describe("validateDownloadSourceUrl", () => {
  it("accepts public http, https and magnet links", () => {
    expect(validateDownloadSourceUrl("https://example.com/file.iso")).toEqual({ ok: true });
    expect(validateDownloadSourceUrl("http://downloads.example.org/a.torrent")).toEqual({ ok: true });
    expect(validateDownloadSourceUrl("magnet:?xt=urn:btih:abcdef")).toEqual({ ok: true });
  });

  it("rejects non-download schemes and malformed URLs", () => {
    expect(validateDownloadSourceUrl("file:///etc/passwd").ok).toBe(false);
    expect(validateDownloadSourceUrl("ftp://example.com/file").ok).toBe(false);
    expect(validateDownloadSourceUrl("not a url").ok).toBe(false);
  });

  it("rejects URLs with userinfo, explicit ports or excessive length", () => {
    expect(validateDownloadSourceUrl("https://user:pass@example.com/file").ok).toBe(false);
    expect(validateDownloadSourceUrl("https://example.com:8443/file").ok).toBe(false);
    expect(validateDownloadSourceUrl(`https://example.com/${"a".repeat(4097)}`).ok).toBe(false);
  });

  it("rejects loopback, private, link-local, multicast and metadata endpoints", () => {
    const blocked = [
      "http://localhost/admin",
      "http://127.0.0.1:8080/",
      "http://10.0.0.5/file",
      "http://172.16.2.3/file",
      "http://192.168.1.8/file",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://[fc00::1]/",
      "http://[fe80::1]/",
      "http://224.0.0.1/file",
      // IPv4-mapped and deprecated IPv4-compatible IPv6 forms must resolve to
      // their embedded IPv4 and be blocked (no ::a.b.c.d metadata bypass).
      "http://[::ffff:169.254.169.254]/latest/meta-data/",
      "http://[::127.0.0.1]/",
      "http://[::169.254.169.254]/latest/meta-data/",
      "http://[::a9fe:a9fe]/latest/meta-data/",
    ];

    for (const url of blocked) {
      expect(validateDownloadSourceUrl(url), url).toMatchObject({ ok: false });
    }
  });

  it("rejects hostnames that are explicitly configured as internal suffixes", () => {
    expect(
      validateDownloadSourceUrl("https://files.internal.example/file", {
        blockedHostnameSuffixes: [".internal.example"],
      }),
    ).toMatchObject({ ok: false });
  });
});

describe("assertDownloadSourceUrlSafe", () => {
  it("resolves hostnames and rejects DNS answers pointing at private or metadata addresses", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);

    await expect(assertDownloadSourceUrlSafe("https://evil.example/file.iso")).resolves.toMatchObject({
      ok: false,
      reason: "Download URL DNS resolved to an intranet, loopback, or link-local address",
    });
    expect(lookupMock).toHaveBeenCalledWith("evil.example", { all: true, verbatim: true });
  });

  it("resolves hostnames and rejects DNS answers pointing at unique-local IPv6 addresses", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "fd00::1234", family: 6 }]);

    await expect(assertDownloadSourceUrlSafe("https://ipv6.example/file.iso")).resolves.toMatchObject({
      ok: false,
      reason: "Download URL DNS resolved to an intranet, loopback, or link-local address",
    });
  });

  it("accepts public DNS answers and skips DNS for magnet links", async () => {
    lookupMock.mockReset();
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);

    await expect(assertDownloadSourceUrlSafe("https://example.com/file.iso")).resolves.toEqual({
      ok: true,
      resolution: {
        hostname: "example.com",
        address: "93.184.216.34",
        port: 443,
      },
    });
    await expect(assertDownloadSourceUrlSafe("magnet:?xt=urn:btih:abcdef")).resolves.toEqual({ ok: true, url: "magnet:?xt=urn:btih:abcdef" });
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });
});

describe("sanitizeMagnetLink", () => {
  it("keeps public trackers over tracker protocols and drops the rest, byte for byte otherwise", () => {
    // aria2 announces to every tracker with a GET or a UDP packet: a tracker on the hub's own network, a local name
    // or a non-tracker scheme is dropped, and the hash and names are not re-encoded on the way.
    const link = "magnet:?xt=urn:btih:ABCDEF0123&dn=Some%20Name%20%5B1080p%5D"
      + "&tr=udp%3A%2F%2Ftracker.example.org%3A6969%2Fannounce"
      + "&tr=http%3A%2F%2F127.0.0.1%3A8080%2Fannounce"
      + "&tr=https%3A%2F%2F10.0.0.5%2Fannounce"
      + "&tr=http%3A%2F%2Ftracker.lan%2Fannounce"
      + "&tr=file%3A%2F%2F%2Fetc%2Fpasswd"
      + "&tr=http%3A%2F%2Fuser%3Apass%40tracker.example.net%2Fannounce"
      + "&tr=wss%3A%2F%2Ftracker.example.com%2F"
      + "&tr=%ZZ";
    expect(sanitizeMagnetLink(link)).toEqual({
      url: "magnet:?xt=urn:btih:ABCDEF0123&dn=Some%20Name%20%5B1080p%5D&tr=udp%3A%2F%2Ftracker.example.org%3A6969%2Fannounce&tr=wss%3A%2F%2Ftracker.example.com%2F",
      droppedTrackers: 6,
    });
  });

  it("leaves a link without trackers alone and reports what the safe form is", async () => {
    expect(sanitizeMagnetLink("magnet:?xt=urn:btih:abcdef&dn=x")).toEqual({ url: "magnet:?xt=urn:btih:abcdef&dn=x", droppedTrackers: 0 });
    await expect(assertDownloadSourceUrlSafe("magnet:?xt=urn:btih:abcdef&tr=http%3A%2F%2Flocalhost%2Fa")).resolves.toEqual({ ok: true, url: "magnet:?xt=urn:btih:abcdef" });
  });
});
