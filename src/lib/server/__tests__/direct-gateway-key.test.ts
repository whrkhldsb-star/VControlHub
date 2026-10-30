import { describe, expect, it } from "vitest";

import { deriveDirectGatewayServerKey, directGatewaySigningKey } from "../direct-gateway-key";

describe("direct gateway keys", () => {
  it("derives a key per server that reveals nothing about the secret or another server's key", () => {
    const a = deriveDirectGatewayServerKey("master-secret", "srv_a");
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toBe(deriveDirectGatewayServerKey("master-secret", "srv_a"));
    expect(a).not.toBe(deriveDirectGatewayServerKey("master-secret", "srv_b"));
    expect(a).not.toBe(deriveDirectGatewayServerKey("other-secret", "srv_a"));
    expect(a).not.toContain("master-secret");
  });

  it("refuses to derive without a secret or a server", () => {
    expect(() => deriveDirectGatewayServerKey("", "srv_a")).toThrow();
    expect(() => deriveDirectGatewayServerKey("master-secret", "")).toThrow();
  });

  it("signs for an older gateway with the shared secret and for a newer one with its own key", () => {
    expect(directGatewaySigningKey("master-secret", { serverId: "srv_a", keyVersion: 1 })).toBe("master-secret");
    expect(directGatewaySigningKey("master-secret", { serverId: null, keyVersion: 2 })).toBe("master-secret");
    expect(directGatewaySigningKey("master-secret", { serverId: "srv_a", keyVersion: 2 })).toBe(deriveDirectGatewayServerKey("master-secret", "srv_a"));
  });
});
