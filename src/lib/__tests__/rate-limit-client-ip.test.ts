// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { getClientIp } from "../rate-limit";

/**
 * Every IP-scoped limit in the app (login throttling, share-link password
 * throttling, ITSM inbound, AI chat) keys off `getClientIp`, so a spoofable
 * value disables all of them at once: an attacker who controls the bucket
 * gets a fresh one per request. These tests pin the "trust N proxies, read
 * from the right" contract.
 */

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://hub.example/api/anything", { headers });
}

describe("getClientIp", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads one hop from the right for the shipped Caddy reverse_proxy default", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");

    expect(getClientIp(requestWith({ "x-forwarded-for": "198.51.100.7" }))).toBe("198.51.100.7");
  });

  it("ignores the leftmost entry, which is whatever the client chose to send", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");

    // Caddy appends the real peer last; everything before it is attacker text.
    expect(
      getClientIp(requestWith({ "x-forwarded-for": "9.9.9.9, 8.8.8.8, 198.51.100.7" })),
    ).toBe("198.51.100.7");
  });

  it("walks two hops when a CDN sits in front of the reverse proxy", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");

    expect(getClientIp(requestWith({ "x-forwarded-for": "203.0.113.5, 198.51.100.7" }))).toBe(
      "203.0.113.5",
    );
  });

  it("trusts no forwarded header when the app is directly exposed", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "0");

    expect(getClientIp(requestWith({ "x-forwarded-for": "203.0.113.5" }))).toBe("unknown");
  });

  it("falls back to the shared bucket when the chain is shorter than the hop count", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "3");

    expect(getClientIp(requestWith({ "x-forwarded-for": "203.0.113.5" }))).toBe("unknown");
  });

  it("strips ports and IPv6 brackets before keying a bucket", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");

    expect(getClientIp(requestWith({ "x-forwarded-for": "203.0.113.5:54321" }))).toBe("203.0.113.5");
    expect(getClientIp(requestWith({ "x-forwarded-for": "[2001:db8::1]:443" }))).toBe("2001:db8::1");
  });

  it("rejects values that would inject into store keys or audit rows", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");

    // The Headers API itself refuses CR/LF, so the remaining shape worth
    // pinning is an over-long or whitespace-bearing value sneaking into a
    // Redis key / audit column.
    expect(getClientIp(requestWith({ "x-forwarded-for": "x".repeat(200) }))).toBe("unknown");
    expect(getClientIp(requestWith({ "x-forwarded-for": "203.0.113.5 X-Injected: 1" }))).toBe(
      "unknown",
    );
    expect(getClientIp(requestWith({ "x-forwarded-for": "   " }))).toBe("unknown");
  });

  it("ignores cf-connecting-ip unless the deployment opts in", () => {
    const request = requestWith({
      "x-forwarded-for": "198.51.100.7",
      "cf-connecting-ip": "203.0.113.5",
    });

    expect(getClientIp(request)).toBe("198.51.100.7");

    vi.stubEnv("TRUST_CLOUDFLARE_IP_HEADER", "true");
    expect(getClientIp(request)).toBe("203.0.113.5");
  });

  it("returns a shared bucket when no trusted header is present", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");

    expect(getClientIp(requestWith({}))).toBe("unknown");
  });
});
