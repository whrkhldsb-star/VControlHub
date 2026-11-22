import { describe, expect, it } from "vitest";
import { gatewayMetricsAuthorization, gatewayMetricsUrl, mayScrapeGateway } from "../gateway-metrics";

describe("gateway metrics", () => {
  it.each([["::1", "[::1]"], ["::", "[::1]"], ["0.0.0.0", "127.0.0.1"], ["localhost", "localhost"]])("resolves the local scrape address for %s", (host, expected) => {
    expect(gatewayMetricsUrl(host, 4100).href).toBe(`http://${expected}:4100/metrics`);
  });

  it("accepts only a current credential issued for this gateway", () => {
    const now = 1_800_000_000_000;
    const credential = gatewayMetricsAuthorization("test-key", now);
    expect(mayScrapeGateway(credential, "test-key", now + 20_000)).toBe(true);
    expect(mayScrapeGateway(credential, "test-key", now + 31_000)).toBe(false);
    expect(mayScrapeGateway(credential, "other-key", now)).toBe(false);
    expect(mayScrapeGateway(undefined, "test-key", now)).toBe(false);
    expect(mayScrapeGateway(credential, undefined, now)).toBe(false);
  });
});
