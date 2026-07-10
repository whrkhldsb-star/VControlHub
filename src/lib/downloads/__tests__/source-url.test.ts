import { describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
}));

import { assertDownloadSourceUrlSafe, validateDownloadSourceUrl } from "@/lib/downloads/source-url";

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

    await expect(assertDownloadSourceUrlSafe("https://example.com/file.iso")).resolves.toEqual({ ok: true });
    await expect(assertDownloadSourceUrlSafe("magnet:?xt=urn:btih:abcdef")).resolves.toEqual({ ok: true });
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });
});
