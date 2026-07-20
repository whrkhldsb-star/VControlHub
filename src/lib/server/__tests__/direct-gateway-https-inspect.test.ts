import { describe, it, expect } from "vitest";
import {
  buildDirectGatewayPublicBaseUrl,
  buildInstallDirectGatewayCommand,
  DIRECT_GATEWAY_DEFAULT_PORT,
} from "@/lib/server/direct-gateway";

describe("direct gateway auto https", () => {
  it("emits loopback bind, caddy unit, SAN, quoted proxy health, and safe shellQuote", () => {
    const c = buildInstallDirectGatewayCommand({
      rootPath: "/data/media",
      secret: "a'b",
      autoReverseProxy: true,
      tlsHost: "203.0.113.10",
    });
    expect(c).toContain("subjectAltName=IP:203.0.113.10");
    expect(c).toContain("<<'VCH_DIRECT_PROXY_HEALTH'");
    expect(c).toContain("https://127.0.0.1:443/__vch_health");
    expect(c).toContain("DIRECT_BIND='127.0.0.1'");
    expect(c).toContain("DIRECT_SECRET='a'\"'\"'b'");
    expect(c).toContain("vcontrolhub-direct-caddy.service");
    expect(c).toContain("reverse_proxy 127.0.0.1:31888");
    expect(c).toContain("openssl req -x509 -newkey rsa:2048 -nodes");
  });

  it("uses default https port only when autoReverseProxy is true", () => {
    expect(
      buildDirectGatewayPublicBaseUrl({
        host: "203.0.113.10",
        protocol: "https",
        autoReverseProxy: true,
      }),
    ).toBe("https://203.0.113.10");
    expect(
      buildDirectGatewayPublicBaseUrl({
        host: "203.0.113.10",
        protocol: "https",
        autoReverseProxy: false,
        port: DIRECT_GATEWAY_DEFAULT_PORT,
      }),
    ).toBe(`https://203.0.113.10:${DIRECT_GATEWAY_DEFAULT_PORT}`);
  });
});
