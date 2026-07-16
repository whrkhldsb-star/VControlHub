/**
 * Cloud billing adapters + service unit tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const accountStore = new Map<string, Record<string, unknown>>();
const runStore = new Map<string, Record<string, unknown>>();
const entryStore = new Map<string, Record<string, unknown>>();
let seq = 0;

function reset() {
	accountStore.clear();
	runStore.clear();
	entryStore.clear();
	seq = 0;
}

vi.mock("@/lib/db", () => ({
	prisma: {
		cloudBillingAccount: {
			create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
				seq += 1;
				const row = {
					id: `acc_${seq}`,
					lastSyncAt: null,
					lastSyncStatus: null,
					lastSyncError: null,
					lastSyncImported: 0,
					lastSyncSkipped: 0,
					createdAt: new Date("2026-07-01T00:00:00Z"),
					updatedAt: new Date("2026-07-01T00:00:00Z"),
					...data,
				};
				accountStore.set(row.id as string, row);
				return row;
			}),
			findMany: vi.fn(async () => Array.from(accountStore.values())),
			findUnique: vi.fn(async ({ where }: { where: { id: string } }) => accountStore.get(where.id) ?? null),
			update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
				const prev = accountStore.get(where.id);
				if (!prev) throw new Error("missing");
				const next = { ...prev, ...data, updatedAt: new Date("2026-07-02T00:00:00Z") };
				accountStore.set(where.id, next);
				return next;
			}),
			deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
				const existed = accountStore.delete(where.id);
				return { count: existed ? 1 : 0 };
			}),
		},
		cloudBillingSyncRun: {
			create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
				seq += 1;
				const row = {
					id: `run_${seq}`,
					imported: 0,
					skipped: 0,
					errorMessage: null,
					startedAt: new Date("2026-07-01T01:00:00Z"),
					finishedAt: null,
					...data,
				};
				runStore.set(row.id as string, row);
				return row;
			}),
			update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
				const prev = runStore.get(where.id);
				if (!prev) throw new Error("missing run");
				const next = { ...prev, ...data };
				runStore.set(where.id, next);
				return next;
			}),
			findMany: vi.fn(async ({ where }: { where: { accountId: string } }) =>
				Array.from(runStore.values()).filter((r) => r.accountId === where.accountId),
			),
		},
		costEntry: {
			upsert: vi.fn(
				async ({
					where,
					create,
					update,
				}: {
					where: { sourceType_sourceRef_effectiveDate: { sourceType: string; sourceRef: string; effectiveDate: Date } };
					create: Record<string, unknown>;
					update: Record<string, unknown>;
				}) => {
					const key = `${where.sourceType_sourceRef_effectiveDate.sourceType}|${where.sourceType_sourceRef_effectiveDate.sourceRef}|${where.sourceType_sourceRef_effectiveDate.effectiveDate.toISOString()}`;
					const existing = entryStore.get(key);
					if (existing) {
						const next = { ...existing, ...update };
						entryStore.set(key, next);
						return next;
					}
					seq += 1;
					const row = { id: `ce_${seq}`, ...create };
					entryStore.set(key, row);
					return row;
				},
			),
		},
	},
}));

vi.mock("@/lib/crypto/service", () => ({
	encrypt: (s: string) => `enc:${s}`,
	decrypt: (s: string) => {
		if (!s.startsWith("enc:")) throw new Error("bad");
		return s.slice(4);
	},
	isEncrypted: (s: string) => s.startsWith("enc:"),
}));

vi.mock("@/lib/logging", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { parseBillingCsv } from "../adapters";
import {
	createCloudBillingAccount,
	deleteCloudBillingAccount,
	listCloudBillingAccounts,
	syncCloudBillingAccount,
} from "../service";

describe("parseBillingCsv", () => {
	it("parses date/amount rows", () => {
		const items = parseBillingCsv(
			`date,amount,currency,category,product,notes
2026-07-01,10.5,USD,vps,ec2,hello
2026-07-02,bad,USD,vps,ec2,skip
`,
			{ currency: "USD", providerLabel: "CSV" },
		);
		expect(items).toHaveLength(1);
		expect(items[0]?.amount).toBe("10.50");
		expect(items[0]?.category).toBe("vps");
		expect(items[0]?.providerLabel).toContain("ec2");
	});

	it("rejects missing columns", () => {
		expect(() => parseBillingCsv("foo,bar\n1,2", { currency: "USD", providerLabel: "CSV" })).toThrow(
			/date and amount/,
		);
	});
});

describe("cloud billing service", () => {
	beforeEach(() => {
		reset();
		process.env.VCONTROLHUB_CLOUD_BILLING_MOCK = "1";
	});
	afterEach(() => {
		delete process.env.VCONTROLHUB_CLOUD_BILLING_MOCK;
		vi.clearAllMocks();
	});

	it("creates account without returning secrets", async () => {
		const account = await createCloudBillingAccount(
			{
				name: "prod-aws",
				provider: "aws",
				currency: "USD",
				credentials: { accessKeyId: "AKIA", secretAccessKey: "secret" },
				config: { region: "us-east-1" },
			},
			"user_1",
		);
		expect(account.name).toBe("prod-aws");
		expect(account.hasCredentials).toBe(true);
		expect(JSON.stringify(account)).not.toContain("secret");
		expect(JSON.stringify(account)).not.toContain("AKIA");
	});

	it("imports CSV line items into cost entries on sync", async () => {
		const account = await createCloudBillingAccount(
			{
				name: "csv-acct",
				provider: "generic_csv",
				currency: "USD",
				credentials: {},
				config: {
					sampleCsv: `date,amount,currency,category,product,notes
2026-07-01,10.00,USD,vps,ec2,a
2026-07-15,2.00,USD,bandwidth,dt,b
`,
				},
			},
			"user_1",
		);
		const result = await syncCloudBillingAccount(account.id, "2026-07");
		expect(result.imported).toBe(2);
		expect(result.run.status).toBe("ok");
		expect(entryStore.size).toBe(2);
		const listed = await listCloudBillingAccounts();
		expect(listed[0]?.lastSyncImported).toBe(2);
	});

	it("mock provider path imports probe item", async () => {
		const account = await createCloudBillingAccount(
			{
				name: "aws-probe",
				provider: "aws",
				currency: "USD",
				credentials: { accessKeyId: "AKIA", secretAccessKey: "secret" },
			},
			null,
		);
		const result = await syncCloudBillingAccount(account.id, "2026-07");
		expect(result.imported).toBe(1);
		expect(result.warnings.length).toBeGreaterThan(0);
	});

	it("fails live sync without mock and without sampleCsv", async () => {
		delete process.env.VCONTROLHUB_CLOUD_BILLING_MOCK;
		const account = await createCloudBillingAccount(
			{
				name: "aws-live",
				provider: "aws",
				currency: "USD",
				credentials: { accessKeyId: "AKIA", secretAccessKey: "secret" },
			},
			null,
		);
		await expect(syncCloudBillingAccount(account.id, "2026-07")).rejects.toThrow(/not enabled|Live billing/);
		const runs = Array.from(runStore.values());
		expect(runs.some((r) => r.status === "error")).toBe(true);
	});

	it("deletes account", async () => {
		const account = await createCloudBillingAccount(
			{
				name: "tmp",
				provider: "generic_csv",
				credentials: {},
				config: {
					sampleCsv: `date,amount
2026-07-01,1
`,
				},
			},
			null,
		);
		await deleteCloudBillingAccount(account.id);
		expect(accountStore.size).toBe(0);
	});
});
