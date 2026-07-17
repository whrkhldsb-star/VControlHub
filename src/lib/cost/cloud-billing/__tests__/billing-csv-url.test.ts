import { afterEach, describe, expect, it, vi } from "vitest";

import * as directAccessUrl from "@/lib/storage/direct-access-url";

import { fetchCloudBillingItems } from "../adapters";
import { createCloudBillingAccountSchema } from "../schema";

describe("billingCsvUrl live path", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("imports CSV from https URL", async () => {
		vi.spyOn(directAccessUrl, "assertPublicBaseUrlResolvesPublic").mockResolvedValue(
			"https://example.com",
		);
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
		).rejects.toThrow(/not allowed|SSRF|public http/i);
	});

	it("blocks IPv6 ULA style hosts at normalize time", async () => {
		await expect(
			fetchCloudBillingItems({
				provider: "aws",
				credentials: { accessKeyId: "AKIA", secretAccessKey: "secret" },
				config: { billingCsvUrl: "http://[fd00::1]/bill.csv" },
				month: "2026-07",
				currency: "USD",
			}),
		).rejects.toThrow(/not allowed|SSRF|public http/i);
	});

	it("generic_csv accepts billingCsvUrl without sampleCsv", async () => {
		vi.spyOn(directAccessUrl, "assertPublicBaseUrlResolvesPublic").mockResolvedValue(
			"https://example.com",
		);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				text: async () => "date,amount\n2026-07-03,1.25\n",
			})),
		);

		const result = await fetchCloudBillingItems({
			provider: "generic_csv",
			credentials: {},
			config: { billingCsvUrl: "https://example.com/export.csv" },
			month: "2026-07",
			currency: "USD",
		});
		expect(result.items).toHaveLength(1);
		expect(result.items[0]?.amount).toBe("1.25");
	});
});

describe("createCloudBillingAccountSchema billingCsvUrl", () => {
	it("accepts and normalizes public billingCsvUrl on create", () => {
		const parsed = createCloudBillingAccountSchema.parse({
			name: "Live CUR",
			provider: "aws",
			credentials: { accessKeyId: "AKIA", secretAccessKey: "secret" },
			config: { billingCsvUrl: "https://example.com/bill.csv" },
		});
		expect(parsed.config?.billingCsvUrl).toBe("https://example.com/bill.csv");
	});

	it("rejects private billingCsvUrl on create", () => {
		expect(() =>
			createCloudBillingAccountSchema.parse({
				name: "Bad",
				provider: "aws",
				credentials: { accessKeyId: "AKIA", secretAccessKey: "secret" },
				config: { billingCsvUrl: "http://192.168.1.1/bill.csv" },
			}),
		).toThrow();
	});

	it("allows generic_csv with only billingCsvUrl", () => {
		const parsed = createCloudBillingAccountSchema.parse({
			name: "CSV live",
			provider: "generic_csv",
			credentials: {},
			config: { billingCsvUrl: "https://example.com/bill.csv" },
		});
		expect(parsed.config?.billingCsvUrl).toMatch(/^https:\/\//);
		expect(parsed.config?.sampleCsv).toBeUndefined();
	});

	it("still requires sampleCsv or billingCsvUrl for generic_csv", () => {
		expect(() =>
			createCloudBillingAccountSchema.parse({
				name: "Empty",
				provider: "generic_csv",
				credentials: {},
				config: {},
			}),
		).toThrow(/sampleCsv|billingCsvUrl/);
	});
});
