import { beforeEach, describe, expect, it, vi } from "vitest";

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

const savePrismaMock = vi.hoisted(() => ({
	setting: {
		findMany: vi.fn(),
		findUnique: vi.fn(),
		upsert: vi.fn(),
	},
	$transaction: vi.fn(async (ops: unknown[]) => {
		// setManySettings builds an array of upsert promises; resolve them.
		await Promise.all(ops as Promise<unknown>[]);
		return ops;
	}),
}));

describe("saveOffsiteConfig key mapping + encryption", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		vi.doMock("@/lib/db", () => ({ prisma: savePrismaMock }));
		vi.doMock("@/lib/crypto/service", () => ({
			encrypt: (value: string) => `encrypted:${value}`,
			decrypt: (value: string) => value.replace(/^encrypted:/, ""),
			isEncrypted: (value: string) => value.startsWith("encrypted:"),
		}));
		// Defaults only — no existing rows so load merges DEFAULTS.
		savePrismaMock.setting.findMany.mockResolvedValue([]);
		savePrismaMock.setting.upsert.mockImplementation(async (args: {
			where: { key: string };
			create: { key: string; value: string };
			update: { value: string };
		}) => ({ key: args.where.key, value: args.update?.value ?? args.create.value }));
	});

	it("writes camelCase offsite.* keys (not kebab-case orphans) and encrypts secretAccessKey", async () => {
		const { saveOffsiteConfig } = await import("../offsite/schema");
		await saveOffsiteConfig({
			enabled: true,
			provider: "s3",
			endpoint: "https://s3.example.com",
			region: "us-east-1",
			bucket: "backups",
			accessKeyId: "AKIAEXAMPLE",
			secretAccessKey: "supersecret",
			pathPrefix: "vcontrolhub-backups",
			dailyWindowHour: 4,
			retentionDays: 14,
			failureAlertRecipient: "ops@example.com",
		});

		const upsertedKeys = savePrismaMock.setting.upsert.mock.calls.map(
			(call) => (call[0] as { where: { key: string } }).where.key,
		);
		// Must use the same keys loadOffsiteConfig / VALID_SETTING_KEYS expect.
		expect(upsertedKeys).toEqual(
			expect.arrayContaining([
				"offsite.enabled",
				"offsite.provider",
				"offsite.endpoint",
				"offsite.region",
				"offsite.bucket",
				"offsite.accessKeyId",
				"offsite.secretAccessKey",
				"offsite.pathPrefix",
				"offsite.dailyWindowHour",
				"offsite.retentionDays",
				"offsite.failureAlertRecipient",
			]),
		);
		// Regression: previous camelToKebab wrote these orphan keys.
		expect(upsertedKeys).not.toEqual(
			expect.arrayContaining([
				"offsite.access-key-id",
				"offsite.secret-access-key",
				"offsite.path-prefix",
				"offsite.daily-window-hour",
				"offsite.retention-days",
				"offsite.failure-alert-recipient",
			]),
		);

		const secretCall = savePrismaMock.setting.upsert.mock.calls.find(
			(call) => (call[0] as { where: { key: string } }).where.key === "offsite.secretAccessKey",
		);
		expect(secretCall).toBeTruthy();
		const secretArgs = secretCall![0] as { create: { value: string }; update: { value: string } };
		expect(secretArgs.create.value).toBe("encrypted:supersecret");
		expect(secretArgs.update.value).toBe("encrypted:supersecret");

		// accessKeyId matches /key/i sensitive pattern too — ensure encrypted.
		const accessKeyCall = savePrismaMock.setting.upsert.mock.calls.find(
			(call) => (call[0] as { where: { key: string } }).where.key === "offsite.accessKeyId",
		);
		const accessArgs = accessKeyCall![0] as { create: { value: string } };
		expect(accessArgs.create.value).toBe("encrypted:AKIAEXAMPLE");

		const enabledCall = savePrismaMock.setting.upsert.mock.calls.find(
			(call) => (call[0] as { where: { key: string } }).where.key === "offsite.enabled",
		);
		const enabledArgs = enabledCall![0] as { create: { value: string } };
		expect(enabledArgs.create.value).toBe("true");
	});
});
