import { PEER_ADDRESS_HEADER } from "@/lib/http/peer-address";
import { describe, expect, it, vi } from "vitest";
import { config } from "@/lib/config/env";
import { PreAuthLimiter, upgradeClientAddress, PEER_SIGNATURE_HEADER, signUpgradePeer } from "../pre-auth-limiter";

describe("PreAuthLimiter", () => {
  it("holds a total and a per-address cap, and frees a place once", () => {
    const limiter = new PreAuthLimiter(3, 2);
    const first = limiter.acquire("203.0.113.1");
    const second = limiter.acquire("203.0.113.1");
    // The address has used its two places; another address may still come in.
    expect(limiter.acquire("203.0.113.1")).toBeNull();
    const third = limiter.acquire("203.0.113.2");
    expect(third).not.toBeNull();
    // The total is full for everyone.
    expect(limiter.acquire("203.0.113.3")).toBeNull();
    expect(limiter.size).toBe(3);

    first!();
    first!(); // releasing twice frees only one place
    expect(limiter.size).toBe(2);
    expect(limiter.acquire("203.0.113.1")).not.toBeNull();
    second!();
    third!();
  });

  it("applies only the total when the address is unknown (no trusted forwarding header)", () => {
    const limiter = new PreAuthLimiter(10, 1);
    const places = Array.from({ length: 10 }, () => limiter.acquire("unknown"));
    expect(places.every(Boolean)).toBe(true);
    expect(limiter.acquire("unknown")).toBeNull();
  });
});

describe("upgradeClientAddress", () => {
  it("uses the socket peer directly and authenticates a loopback listener's observation", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
    vi.stubEnv("SSH_WS_SECRET", "test-signature-key");
    try {
      const headers = { "x-forwarded-for": "192.0.2.6", "sec-websocket-key": "fixture", [PEER_ADDRESS_HEADER]: "192.0.2.5" };
      const address = (peer: string, extra = {}) => upgradeClientAddress({ headers: { ...headers, ...extra }, socket: { remoteAddress: peer } });
      expect(address("192.0.2.4")).toBe("192.0.2.4");
      expect(address("127.0.0.1")).toBe("127.0.0.1");
      const signed = signUpgradePeer("192.0.2.5", "fixture", "test-signature-key");
      expect(address("127.0.0.1", { [PEER_SIGNATURE_HEADER]: signed })).toBe("192.0.2.5");
    } finally { vi.unstubAllEnvs(); }
  });
  it("reads the address the way HTTP rate limits do: the entry the nearest trusted proxy added", () => {
    // With the default of one trusted hop, the rightmost entry is the one the proxy appended; what the client
    // sent in front of it is not believed.
    expect(upgradeClientAddress({ headers: { "x-forwarded-for": "198.51.100.9, 203.0.113.7" } })).toBe("203.0.113.7");
    expect(upgradeClientAddress({ headers: {} })).toBe("unknown");
  });

  it("verifies a forwarded peer signed by the web tier even when SSH_WS_SECRET carries stray whitespace", () => {
    // The forwarder and the gateway read the same env file; one side trimming and the other not left every
    // forwarded peer unverified, so all of them shared the "unknown" bucket.
    vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
    vi.stubEnv("SSH_WS_SECRET", "  test-signature-key\n");
    try {
      expect(config.ssh.wsSecret).toBe("test-signature-key");
      const signed = signUpgradePeer("192.0.2.5", "fixture", " test-signature-key ");
      expect(signed).toBe(signUpgradePeer("192.0.2.5", "fixture", "test-signature-key"));
      const headers = { "sec-websocket-key": "fixture", [PEER_ADDRESS_HEADER]: "192.0.2.5", [PEER_SIGNATURE_HEADER]: signed! };
      expect(upgradeClientAddress({ headers, socket: { remoteAddress: "127.0.0.1" } })).toBe("192.0.2.5");
      vi.stubEnv("SSH_WS_SECRET", "   ");
      expect(config.ssh.wsSecret).toBeUndefined();
      expect(signUpgradePeer("192.0.2.5", "fixture", "   ")).toBeUndefined();
    } finally { vi.unstubAllEnvs(); }
  });
});
