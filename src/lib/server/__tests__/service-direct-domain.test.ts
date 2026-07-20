import { describe, expect, it } from "vitest";
import { normalizeDirectGatewayPublicDomain } from "@/lib/server/service-direct-gateway";

describe("normalizeDirectGatewayPublicDomain", () => {
  it("returns null for empty", () => {
    expect(normalizeDirectGatewayPublicDomain("")).toBeNull();
    expect(normalizeDirectGatewayPublicDomain("  ")).toBeNull();
    expect(normalizeDirectGatewayPublicDomain(null)).toBeNull();
  });

  it("strips scheme and path", () => {
    expect(normalizeDirectGatewayPublicDomain("https://Direct.Example.com/path")).toBe(
      "direct.example.com",
    );
  });

  it("rejects localhost", () => {
    expect(() => normalizeDirectGatewayPublicDomain("localhost")).toThrow(/localhost/i);
  });
});
