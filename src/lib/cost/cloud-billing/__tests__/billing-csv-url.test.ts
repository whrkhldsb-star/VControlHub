import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchCloudBillingItems } from "../adapters";

describe("billingCsvUrl live path", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("imports CSV from https URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => "date,amount,category\n2026-07-01,9.99,vps\n",
      })),
    );
    const result = await fetchCloudBillingItems({
      provider: "aws",
      credentials: { accessKeyId: "AKIA", secretAccessKey: "secret" },
      config: { billingCsvUrl: "https://example.com/bill.csv" },
      month: "2026-07",
      currency: "USD",
    });
    expect(result.items.length).toBe(1);
    expect(result.warnings[0]).toMatch(/billingCsvUrl/);
  });

  it("blocks localhost SSRF", async () => {
    await expect(
      fetchCloudBillingItems({
        provider: "aws",
        credentials: { accessKeyId: "AKIA", secretAccessKey: "secret" },
        config: { billingCsvUrl: "http://127.0.0.1/bill.csv" },
        month: "2026-07",
        currency: "USD",
      }),
    ).rejects.toThrow(/not allowed|SSRF/i);
  });
});
