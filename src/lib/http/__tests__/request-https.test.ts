import { afterEach, describe, expect, it, vi } from "vitest";

import { isRequestHttps } from "../request-https";

describe("isRequestHttps", () => {
  it("returns true when URL protocol is https", () => {
    const request = new Request("https://console.example.test/api/login", { method: "POST" });
    expect(isRequestHttps(request)).toBe(true);
  });

  it("returns false when URL protocol is http and no forwarded proto", () => {
    const request = new Request("http://127.0.0.1:3000/api/login", { method: "POST" });
    expect(isRequestHttps(request)).toBe(false);
  });

  it("returns true when X-Forwarded-Proto is https behind a reverse proxy", () => {
    const request = new Request("http://127.0.0.1:3000/api/login", {
      method: "POST",
      headers: { "x-forwarded-proto": "https" },
    });
    expect(isRequestHttps(request)).toBe(true);
  });

  it("uses the left-most hop when X-Forwarded-Proto is a list", () => {
    const request = new Request("http://127.0.0.1:3000/api/login", {
      method: "POST",
      headers: { "x-forwarded-proto": "https, http" },
    });
    expect(isRequestHttps(request)).toBe(true);
  });

  it("keeps Secure when URL is https even if a spoofed X-Forwarded-Proto is http", () => {
    const request = new Request("https://console.example.test/api/login", {
      method: "POST",
      headers: { "x-forwarded-proto": "http" },
    });
    expect(isRequestHttps(request)).toBe(true);
  });

  describe("with no trusted reverse proxy (TRUSTED_PROXY_HOPS=0)", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("ignores a client-sent X-Forwarded-Proto: the app is exposed directly", () => {
      vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
      const request = new Request("http://203.0.113.5:3000/api/login", {
        method: "POST",
        headers: { "x-forwarded-proto": "https" },
      });
      expect(isRequestHttps(request)).toBe(false);
    });

    it("still reads the request URL itself", () => {
      vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
      expect(isRequestHttps(new Request("https://console.example.test/api/login", { method: "POST" }))).toBe(true);
    });

    it("believes the header again once a proxy hop is trusted", () => {
      vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
      const request = new Request("http://127.0.0.1:3000/api/login", {
        method: "POST",
        headers: { "x-forwarded-proto": "https" },
      });
      expect(isRequestHttps(request)).toBe(true);
    });
  });
});
