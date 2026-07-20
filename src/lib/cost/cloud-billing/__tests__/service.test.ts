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
					teamId: null,
					createdAt: new Date("2026-07-01T00:00:00Z"),
					updatedAt: new Date("2026-07-01T00:00:00Z"),
					...data,
				};
				accountStore.set(row.id as string, row);
				return row;
			}),
			findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
				const rows = Array.from(accountStore.values());
				if (!where || Object.keys(where).length === 0) return rows;
				if (where.teamId === null) {
					return rows.filter((r) => r.teamId == null);
				}
				const or = where.OR as Array<Record<string, unknown>> | undefined;
				if (or) {
					const teamIds = or
						.map((c) => c.teamId)
						.filter((v): v is string | null => v !== undefined);
					return rows.filter((r) => teamIds.includes(r.teamId as string | null) || r.teamId == null);
				}
				return rows;
			}),
			findUnique: vi.fn(async ({ where }: { where: { id: string } }) => accountStore.get(where.id) ?? null),
			findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
				const rows = Array.from(accountStore.values());
				const id = where.id as string | undefined;
				const candidates = id ? rows.filter((r) => r.id === id) : rows;
				if (candidates.length === 0) return null;
				if (where.teamId === null) {
					return candidates.find((r) => r.teamId == null) ?? null;
				}
				const or = where.OR as Array<Record<string, unknown>> | undefined;
				if (or) {
					const teamIds = or
						.map((c) => c.teamId)
						.filter((v): v is string | null => v !== undefined);
					return (
						candidates.find(
							(r) => teamIds.includes(r.teamId as string | null) || r.teamId == null,
						) ?? null
					);
				}
				return candidates[0] ?? null;
			}),
			update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
				const prev = accountStore.get(where.id);
				if (!prev) throw new Error("missing");
				// Prisma relation style: team: { connect } | { disconnect }
				const teamRel = data.team as
					| { connect?: { id: string }; disconnect?: boolean }
					| undefined;
				const nextData = { ...data };
				delete nextData.team;
				if (teamRel?.disconnect) nextData.teamId = null;
				if (teamRel?.connect?.id) nextData.teamId = teamRel.connect.id;
				const next = { ...prev, ...nextData, updatedAt: new Date("2026-07-02T00:00:00Z") };
				accountStore.set(where.id, next);
				return next;
			}),
			deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
				const id = where.id as string;
				const row = accountStore.get(id);
				if (!row) return { count: 0 };
				if (where.teamId === null && row.teamId != null) return { count: 0 };
				const or = where.OR as Array<Record<string, unknown>> | undefined;
				if (or) {
					const teamIds = or
						.map((c) => c.teamId)
						.filter((v): v is string | null => v !== undefined);
					if (!(teamIds.includes(row.teamId as string | null) || row.teamId == null)) {
						return { count: 0 };
					}
				}
				accountStore.delete(id);
				return { count: 1 };
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

vi.mock("@/lib/auth/authorization", () => ({
	sessionHasPermission: vi.fn((session: { roles?: string[] }, perm: string) => {
		if (perm === "team:manage" && session.roles?.includes("admin")) return true;
		return false;
	}),
}));

import { parseBillingCsv } from "../adapters";
import {
	createCloudBillingAccount,
	deleteCloudBillingAccount,
	getCloudBillingAccount,
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
			{ userId: "user_1", roles: ["operator"], currentTeamId: null },
		);
		expect(account.name).toBe("prod-aws");
		expect(account.hasCredentials).toBe(true);
		expect(account.teamId).toBeNull();
		expect(JSON.stringify(account)).not.toContain("secret");
		expect(JSON.stringify(account)).not.toContain("AKIA");
	});

	it("ignores body teamId and stamps session currentTeamId", async () => {
		const account = await createCloudBillingAccount(
			{
				name: "spoof-attempt",
				provider: "aws",
				currency: "USD",
				credentials: { accessKeyId: "AKIA", secretAccessKey: "secret" },
				// Client may still send teamId; schema strips it before service use.
				teamId: "team_foreign",
			} as Record<string, unknown>,
			{ userId: "u1", roles: ["operator"], currentTeamId: "team_a" },
		);
		expect(account.teamId).toBe("team_a");
	});

	it("list scopes by team for non-admin session", async () => {
		await createCloudBillingAccount(
			{
				name: "a",
				provider: "aws",
				credentials: { accessKeyId: "A", secretAccessKey: "s" },
			},
			{ userId: "u1", roles: ["operator"], currentTeamId: "team_a" },
		);
		// Seed a foreign-team account via null session (system path) then force teamId in store
		const foreign = await createCloudBillingAccount(
			{
				name: "b",
				provider: "aws",
				credentials: { accessKeyId: "B", secretAccessKey: "s" },
			},
			null,
		);
		const foreignRow = accountStore.get(foreign.id);
		if (foreignRow) {
			foreignRow.teamId = "team_b";
			accountStore.set(foreign.id, foreignRow);
		}
		const listed = await listCloudBillingAccounts({
			userId: "u1",
			roles: ["operator"],
			currentTeamId: "team_a",
		});
		expect(listed.map((a) => a.name)).toEqual(["a"]);
	});

	it("get denies foreign team account", async () => {
		const foreign = await createCloudBillingAccount(
			{
				name: "foreign",
				provider: "aws",
				credentials: { accessKeyId: "A", secretAccessKey: "s" },
			},
			null,
		);
		const foreignRow = accountStore.get(foreign.id);
		if (foreignRow) {
			foreignRow.teamId = "team_b";
			accountStore.set(foreign.id, foreignRow);
		}
		await expect(
			getCloudBillingAccount(foreign.id, {
				userId: "u1",
				roles: ["operator"],
				currentTeamId: "team_a",
			}),
		).rejects.toThrow(/不存在|not found/i);
	});

	it("update does not reassign teamId from body", async () => {
		const { updateCloudBillingAccount } = await import("../service");
		const account = await createCloudBillingAccount(
			{
				name: "stay",
				provider: "aws",
				credentials: { accessKeyId: "A", secretAccessKey: "s" },
			},
			{ userId: "u1", roles: ["operator"], currentTeamId: "team_a" },
		);
		const updated = await updateCloudBillingAccount(
			account.id,
			{ name: "stay-renamed", teamId: "team_b" },
			{ userId: "u1", roles: ["operator"], currentTeamId: "team_a" },
		);
		expect(updated.name).toBe("stay-renamed");
		expect(updated.teamId).toBe("team_a");
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
			{ userId: "user_1", roles: ["operator"], currentTeamId: null },
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
