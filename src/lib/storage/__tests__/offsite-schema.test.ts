import { describe, expect, it } from "vitest";

import {
	OFFSITE_PROVIDER_VALUES,
	OffsiteConfigSchema,
	parseConfigFromMap,
	validateOffsiteConfigForUse,
} from "../offsite/schema";

const VALID_INPUT = {
	enabled: true,
	provider: "s3" as const,
	endpoint: "https://s3.amazonaws.com",
	region: "us-east-1",
	bucket: "my-backups",
	accessKeyId: "AKIAEXAMPLE",
	secretAccessKey: "secret",
	pathPrefix: "vcontrolhub-backups/",
	dailyWindowHour: 3,
	retentionDays: 30,
	failureAlertRecipient: "",
};

describe("OffsiteConfigSchema", () => {
	it("accepts a valid config", () => {
		const out = OffsiteConfigSchema.parse(VALID_INPUT);
		expect(out.provider).toBe("s3");
		expect(out.dailyWindowHour).toBe(3);
		expect(out.pathPrefix).toBe("vcontrolhub-backups/");
	});

	it("rejects an unknown provider", () => {
		const result = OffsiteConfigSchema.safeParse({ ...VALID_INPUT, provider: "ftp" });
		expect(result.success).toBe(false);
	});

	it("rejects an out-of-range daily window hour", () => {
		const r1 = OffsiteConfigSchema.safeParse({ ...VALID_INPUT, dailyWindowHour: 24 });
		expect(r1.success).toBe(false);
		const r2 = OffsiteConfigSchema.safeParse({ ...VALID_INPUT, dailyWindowHour: -1 });
		expect(r2.success).toBe(false);
	});

	it("rejects retentionDays < 1", () => {
		const r = OffsiteConfigSchema.safeParse({ ...VALID_INPUT, retentionDays: 0 });
		expect(r.success).toBe(false);
	});

	it("normalises pathPrefix to end with /", () => {
		const out = OffsiteConfigSchema.parse({ ...VALID_INPUT, pathPrefix: "no-slash" });
		expect(out.pathPrefix.endsWith("/")).toBe(true);
	});
});

describe("parseConfigFromMap", () => {
	it("parses the default settings map (all defaults → enabled false, empty endpoint)", () => {
		const config = parseConfigFromMap({
			"offsite.enabled": "false",
			"offsite.provider": "s3",
			"offsite.endpoint": "",
			"offsite.region": "auto",
			"offsite.bucket": "",
			"offsite.accessKeyId": "",
			"offsite.secretAccessKey": "",
			"offsite.pathPrefix": "vcontrolhub-backups/",
			"offsite.dailyWindowHour": "3",
			"offsite.retentionDays": "30",
			"offsite.failureAlertRecipient": "",
		});
		expect(config.enabled).toBe(false);
		expect(config.pathPrefix).toBe("vcontrolhub-backups/");
	});

	it("enables offsite when enabled=true and credentials provided", () => {
		const config = parseConfigFromMap({
			"offsite.enabled": "true",
			"offsite.provider": "r2",
			"offsite.endpoint": "https://account.r2.cloudflarestorage.com",
			"offsite.region": "auto",
			"offsite.bucket": "my-r2",
			"offsite.accessKeyId": "AKIA-XXX",
			"offsite.secretAccessKey": "secret",
			"offsite.pathPrefix": "vcontrolhub/",
			"offsite.dailyWindowHour": "4",
			"offsite.retentionDays": "60",
			"offsite.failureAlertRecipient": "ops@example.com",
		});
		expect(config.provider).toBe("r2");
		expect(config.dailyWindowHour).toBe(4);
		expect(config.failureAlertRecipient).toBe("ops@example.com");
	});

	it("returns valid output for any of the supported providers", () => {
		for (const provider of OFFSITE_PROVIDER_VALUES) {
			const config = parseConfigFromMap({
				"offsite.enabled": "true",
				"offsite.provider": provider,
				"offsite.endpoint": "https://example.com",
				"offsite.region": "us-east-1",
				"offsite.bucket": "b",
				"offsite.accessKeyId": "k",
				"offsite.secretAccessKey": "s",
				"offsite.pathPrefix": "p/",
				"offsite.dailyWindowHour": "1",
				"offsite.retentionDays": "7",
				"offsite.failureAlertRecipient": "",
			});
			expect(config.provider).toBe(provider);
		}
	});
});

describe("validateOffsiteConfigForUse", () => {
	it("returns no issues for a fully populated config", () => {
		expect(validateOffsiteConfigForUse(OffsiteConfigSchema.parse(VALID_INPUT))).toEqual([]);
	});

	it("flags empty endpoint / bucket / credentials", () => {
		const issues = validateOffsiteConfigForUse(OffsiteConfigSchema.parse({
			...VALID_INPUT,
			endpoint: "",
			bucket: "",
			accessKeyId: "",
			secretAccessKey: "",
		}));
		expect(issues).toContain("Endpoint not configured");
		expect(issues).toContain("Bucket not configured");
		expect(issues).toContain("AccessKeyId not configured");
		expect(issues).toContain("SecretAccessKey not configured");
	});

	it("flags malformed alert email when provided", () => {
		const issues = validateOffsiteConfigForUse(OffsiteConfigSchema.parse({
			...VALID_INPUT,
			failureAlertRecipient: "not-an-email",
		}));
		expect(issues).toContain("failureAlertRecipient is not a valid email address");
	});

	it("skipped checks when enabled=false", () => {
		const issues = validateOffsiteConfigForUse(OffsiteConfigSchema.parse({
			...VALID_INPUT,
			enabled: false,
			endpoint: "",
		}));
		expect(issues).toEqual([]);
	});
});
