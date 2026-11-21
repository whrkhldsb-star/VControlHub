import { createHmac } from "node:crypto";
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

  it("uses a distinct Windows signing key even after reinstalling the same server", () => {
    const windows = directGatewaySigningKey("master-secret", { serverId: "srv_a", keyVersion: 3, operatingSystem: "WINDOWS" });
    expect(windows).toBe(createHmac("sha256", "master-secret").update("vcontrolhub-direct-gateway:v3:windows:srv_a").digest("hex"));
    const windows4 = directGatewaySigningKey("master-secret", { serverId: "srv_a", keyVersion: 4, operatingSystem: "WINDOWS" });
    expect(new Set([windows, windows4, deriveDirectGatewayServerKey("master-secret", "srv_a", 3), deriveDirectGatewayServerKey("master-secret", "srv_a", 4)]).size).toBe(4);
    expect(windows).not.toBe(deriveDirectGatewayServerKey("master-secret", "srv_a", 2));
  });

  it("changes the signing key at every customer transfer and preserves v2 compatibility", () => {
    const sign = (keyVersion: number) => directGatewaySigningKey("master", { serverId: "srv_a", keyVersion });
    expect(sign(2)).toBe(deriveDirectGatewayServerKey("master", "srv_a"));
    expect(sign(3)).toBe(deriveDirectGatewayServerKey("master", "srv_a", 3));
    expect(new Set([sign(2), sign(3), sign(4)]).size).toBe(3);
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
