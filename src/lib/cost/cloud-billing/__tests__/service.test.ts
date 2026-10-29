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

const { acquireLockMock, lockAcquisitions } = vi.hoisted(() => {
  const acquisitions: string[] = [];
  return {
    lockAcquisitions: acquisitions,
    acquireLockMock: vi.fn(async (namespace: string, resourceId: string) => {
      acquisitions.push(`${namespace}:${resourceId}`);
      return async () => undefined;
    }),
  };
});

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
      findMany: vi.fn(
        async ({ where }: { where?: Record<string, unknown> } = {}) => {
          const rows = Array.from(accountStore.values());
          if (!where || Object.keys(where).length === 0) return rows;
          if (where.teamId === null) {
            return rows.filter((r) => r.teamId == null);
          }
          if (typeof where.teamId === "string") {
            return rows.filter((r) => r.teamId === where.teamId);
          }
          const or = where.OR as Array<Record<string, unknown>> | undefined;
          if (or) {
            const teamIds = or
              .map((c) => c.teamId)
              .filter((v): v is string | null => v !== undefined);
            return rows.filter(
              (r) =>
                teamIds.includes(r.teamId as string | null) || r.teamId == null,
            );
          }
          return rows;
        },
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          accountStore.get(where.id) ?? null,
      ),
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          const rows = Array.from(accountStore.values());
          const id = where.id as string | undefined;
          const candidates = id ? rows.filter((r) => r.id === id) : rows;
          if (candidates.length === 0) return null;
          if (where.teamId === null) {
            return candidates.find((r) => r.teamId == null) ?? null;
          }
          if (typeof where.teamId === "string") {
            return candidates.find((r) => r.teamId === where.teamId) ?? null;
          }
          const or = where.OR as Array<Record<string, unknown>> | undefined;
          if (or) {
            const teamIds = or
              .map((c) => c.teamId)
              .filter((v): v is string | null => v !== undefined);
            return (
              candidates.find(
                (r) =>
                  teamIds.includes(r.teamId as string | null) ||
                  r.teamId == null,
              ) ?? null
            );
          }
          return candidates[0] ?? null;
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const prev = accountStore.get(where.id);
          if (!prev) throw new Error("missing");
          // Prisma relation style: team: { connect } | { disconnect }
          const teamRel = data.team as
            { connect?: { id: string }; disconnect?: boolean } | undefined;
          const nextData = { ...data };
          delete nextData.team;
          if (teamRel?.disconnect) nextData.teamId = null;
          if (teamRel?.connect?.id) nextData.teamId = teamRel.connect.id;
          const next = {
            ...prev,
            ...nextData,
            updatedAt: new Date("2026-07-02T00:00:00Z"),
          };
          accountStore.set(where.id, next);
          return next;
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          const id = where.id as string;
          const prev = accountStore.get(id);
          if (!prev) return { count: 0 };
          if (where.teamId === null && prev.teamId != null) return { count: 0 };
          const or = where.OR as Array<Record<string, unknown>> | undefined;
          if (or) {
            const teamIds = or
              .map((c) => c.teamId)
              .filter((v): v is string | null => v !== undefined);
            if (!(
              teamIds.includes(prev.teamId as string | null) ||
              prev.teamId == null
            )) {
              return { count: 0 };
            }
          }
          const next = {
            ...prev,
            ...data,
            updatedAt: new Date("2026-07-02T00:00:00Z"),
          };
          accountStore.set(id, next);
          return { count: 1 };
        },
      ),
      deleteMany: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          const id = where.id as string;
          const row = accountStore.get(id);
          if (!row) return { count: 0 };
          if (where.teamId === null && row.teamId != null) return { count: 0 };
          const or = where.OR as Array<Record<string, unknown>> | undefined;
          if (or) {
            const teamIds = or
              .map((c) => c.teamId)
              .filter((v): v is string | null => v !== undefined);
            if (!(
              teamIds.includes(row.teamId as string | null) ||
              row.teamId == null
            )) {
              return { count: 0 };
            }
          }
          accountStore.delete(id);
          return { count: 1 };
        },
      ),
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
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const prev = runStore.get(where.id);
          if (!prev) throw new Error("missing run");
          const next = { ...prev, ...data };
          runStore.set(where.id, next);
          return next;
        },
      ),
      findMany: vi.fn(async ({ where }: { where: { accountId: string } }) =>
        Array.from(runStore.values()).filter(
          (r) => r.accountId === where.accountId,
        ),
      ),
    },
    costEntry: {
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: {
            sourceType_sourceRef_effectiveDate: {
              sourceType: string;
              sourceRef: string;
              effectiveDate: Date;
            };
          };
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
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// The real lock opens a dedicated pg connection; these tests run without a DB.
// Recording acquisitions lets the serialization test below assert the key shape.
vi.mock("@/lib/concurrency/advisory-lock", () => ({
  acquireAdvisoryLock: acquireLockMock,
}));

vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: vi.fn((session: { roles?: string[] }, perm: string) => {
    if (perm === "team:manage" && session.roles?.includes("admin")) return true;
    return false;
  }),
}));

import { parseBillingCsv, parseBillingCsvRows } from "../adapters";
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

  it("applies categoryMap by product then raw category", () => {
    const items = parseBillingCsv(
      `date,amount,currency,category,product
2026-07-01,1,USD,other,ec2
2026-07-02,2,USD,weird,data-transfer
`,
      {
        currency: "USD",
        providerLabel: "CSV",
        categoryMap: {
          ec2: "vps",
          weird: "bandwidth",
        },
      },
    );
    expect(items).toHaveLength(2);
    expect(items[0]?.category).toBe("vps");
    expect(items[1]?.category).toBe("bandwidth");
  });

  it("keeps identical CSV rows as separate billable line items", () => {
    const items = parseBillingCsv(
      `date,amount,currency,category,product
2026-07-01,10,USD,vps,ec2
2026-07-01,10,USD,vps,ec2`,
      { currency: "USD", providerLabel: "CSV" },
    );
    expect(items).toHaveLength(2);
    expect(items[0]?.externalId).not.toBe(items[1]?.externalId);
    expect(items[0]?.externalId).toMatch(/csv:natural:/);
    expect(items[1]?.externalId).toMatch(/:2$/);
  });

  it("keeps fallback IDs stable when a provider corrects mutable fields", () => {
    const original = parseBillingCsv(
      `date,amount,currency,category,product,notes
2026-07-01,10,USD,vps,ec2,estimated`,
      { currency: "USD", providerLabel: "CSV" },
    );
    const corrected = parseBillingCsv(
      `date,amount,currency,category,product,notes
2026-07-01,12.5,EUR,other,ec2,final`,
      { currency: "USD", providerLabel: "CSV" },
    );

    expect(corrected[0]?.externalId).toBe(original[0]?.externalId);
    expect(corrected[0]).toMatchObject({
      amount: "12.50",
      currency: "EUR",
      category: "other",
      notes: "final",
    });
  });

  it("rejects missing columns", () => {
    expect(() =>
      parseBillingCsv("foo,bar\n1,2", {
        currency: "USD",
        providerLabel: "CSV",
      }),
    ).toThrow(/date|amount|CSV/);
  });

  it("rejects an explicit unsupported currency instead of silently persisting it", () => {
    expect(() =>
      parseBillingCsv(
        `date,amount,currency,category,product
2026-07-01,10,GBP,vps,ec2`,
        { currency: "USD", providerLabel: "CSV" },
      ),
    ).toThrow(/GBP|currency|币种/);
  });

  it("falls back to the account default currency when the column is empty", () => {
    const items = parseBillingCsv(
      `date,amount,currency,category,product
2026-07-01,10,,vps,ec2`,
      { currency: "JPY", providerLabel: "CSV" },
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.currency).toBe("JPY");
  });

  it("skips amounts the Decimal(12,2) amount column cannot hold (as manual entry does)", () => {
    const items = parseBillingCsv(
      `date,amount,currency,category,product
2026-07-01,10000000000,USD,vps,ec2
2026-07-02,9999999999.99,USD,vps,ec2`,
      { currency: "USD", providerLabel: "CSV" },
    );
    expect(items.map((item) => item.amount)).toEqual(["9999999999.99"]);
  });

  it("reads a quoted field that spans lines as part of its record", () => {
    // Split on newlines first, the record was cut after "first line": the
    // charge was booked in the account default currency as "other".
    const items = parseBillingCsv(
      'date,amount,notes,currency,category,product,id\r\n2030-03-01,12.34,"first line\nsecond, line",EUR,storage,disk,charge-1\r\n',
      { currency: "USD", providerLabel: "CSV" },
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      amount: "12.34",
      currency: "EUR",
      category: "storage",
      notes: "first line\nsecond, line",
      externalId: "csv:id:charge-1",
    });
  });

  it("refuses a CSV whose quote never closes instead of guessing the records", () => {
    expect(() => parseBillingCsv('date,amount,notes\n2030-03-01,1,"open', { currency: "USD", providerLabel: "CSV" })).toThrow();
  });

  it("reports the rows it could not read", () => {
    const { items, rejected } = parseBillingCsvRows(
      `date,amount
2026-10-01,5
2026-10-02,not-a-number
2026/10/03,7
2026-10-04,`,
      { currency: "USD", providerLabel: "CSV" },
    );
    expect(items).toHaveLength(1);
    expect(rejected).toEqual([
      { row: 2, reason: "amount", value: "not-a-number" },
      { row: 3, reason: "date", value: "2026/10/03" },
      { row: 4, reason: "amount", value: "" },
    ]);
  });
});

describe("billing CSV amounts", () => {
  const defaults = { currency: "USD" as const, providerLabel: "CSV" };
  const amounts = (csv: string) => parseBillingCsvRows(csv, defaults).items.map((item) => item.amount);

  it("rounds a decimal the way it is written, not the way a binary float stores it", () => {
    // Number(1.005).toFixed(2) is "1.00" and Number(1.255).toFixed(2) "1.25". The cents carry from line to line
    // (2.675 follows 1.005 as 2.67), so the stored lines add up to the file's total rounded half up: 4.935 -> 4.94.
    const stored = amounts("date,amount,product\n2026-10-01,1.005,a\n2026-10-02,2.675,b\n2026-10-03,1.255,c");
    expect(stored).toEqual(["1.01", "2.67", "1.26"]);
    expect(stored.reduce((sum, amount) => sum + Math.round(Number(amount) * 100), 0)).toBe(494);
  });

  it("stores amounts with at most two decimals exactly as written", () => {
    expect(amounts("date,amount,product\n2026-10-01,12.30,a\n2026-10-02,0.07,b\n2026-10-03,100,c")).toEqual(["12.30", "0.07", "100.00"]);
  });

  it("keeps the month's total when a usage-based bill is made of fractions of a cent", () => {
    // 100 lines of 0.0042 used to be 100 lines of 0.00: a bill of 0.42 stored as nothing.
    const lines = Array.from({ length: 100 }, (_, i) => `2026-10-${String((i % 28) + 1).padStart(2, "0")},0.0042,usage`).join("\n");
    const stored = amounts(`date,amount,product\n${lines}`);
    const total = stored.reduce((sum, amount) => sum + Number(amount), 0);
    expect(total).toBeCloseTo(0.42, 2);
    expect(stored.every((amount) => Number(amount) >= 0)).toBe(true);
  });

  it("carries the remainder per currency, so one currency's cents never move into another's", () => {
    const stored = parseBillingCsvRows("date,amount,currency\n2026-10-01,0.004,USD\n2026-10-01,0.004,CNY\n2026-10-02,0.004,USD\n2026-10-02,0.004,CNY\n2026-10-03,0.004,USD", defaults).items;
    expect(stored.filter((item) => item.currency === "USD").map((item) => item.amount)).toEqual(["0.00", "0.01", "0.00"]);
    expect(stored.filter((item) => item.currency === "CNY").map((item) => item.amount)).toEqual(["0.00", "0.01"]);
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
      { userId: "user_1", roles: ["operator"], currentTeamId: "team_a" },
    );
    expect(account.name).toBe("prod-aws");
    expect(account.hasCredentials).toBe(true);
    expect(account.teamId).toBe("team_a");
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
      { userId: "user_1", roles: ["operator"], currentTeamId: "team_a" },
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
    await expect(
      syncCloudBillingAccount(account.id, "2026-07"),
    ).rejects.toThrow(/requires config\.billingCsvUrl/);
    const runs = Array.from(runStore.values());
    expect(runs.some((r) => r.status === "error")).toBe(true);
  });

  it("serializes imports per account+month with an advisory lock", async () => {
    const account = await createCloudBillingAccount(
      {
        name: "locked",
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
    lockAcquisitions.length = 0;

    await syncCloudBillingAccount(account.id, "2026-07");

    // Two concurrent runs would upsert the same unique keys and then both write
    // lastSync* on the account, leaving counters that describe neither run.
    expect(lockAcquisitions).toEqual([`cloud-billing-sync:${account.id}:2026-07`]);
  });

  it("skips and reports a billing line dated on a day that does not exist", async () => {
    const account = await createCloudBillingAccount(
      {
        name: "bad-date",
        provider: "generic_csv",
        credentials: {},
        config: {
          sampleCsv: `date,amount
2026-02-31,89
2026-02-28,11
`,
        },
      },
      null,
    );

    const result = await syncCloudBillingAccount(account.id, "2026-02");

    // 2026-02-31 must not be stored as 2026-03-03 under a February import.
    // The month is then incomplete: it was saved as "ok" with no reason, and
    // after a reload the account card showed nothing wrong.
    expect(result).toMatchObject({ imported: 1, skipped: 1, run: { status: "partial", errorMessage: expect.stringContaining("2026-02-31") } });
    expect(result.warnings.join(" ")).toContain("2026-02-31");
    expect(Array.from(entryStore.values()).map((row) => (row.effectiveDate as Date).toISOString())).toEqual(["2026-02-28T00:00:00.000Z"]);
  });

  it("counts unreadable CSV rows as skipped and says which ones", async () => {
    // They were dropped before the service saw them: "imported 1, skipped 0,
    // ok" for a file with two charges.
    const account = await createCloudBillingAccount(
      { name: "bad-rows", provider: "generic_csv", credentials: {}, config: { sampleCsv: `date,amount
2026-10-01,5
2026-10-02,not-a-number
` } },
      null,
    );

    const result = await syncCloudBillingAccount(account.id, "2026-10");

    expect(result).toMatchObject({ imported: 1, skipped: 1, run: { status: "partial" } });
    expect(result.warnings.join(" ")).toContain("not-a-number");
  });

  it("keeps distinct long external ids on distinct sourceRefs", async () => {
    // Same 140-char prefix and same tail — the shape that used to collapse into
    // one sourceRef, so the second line item overwrote the first.
    const prefix = "A".repeat(200);
    const account = await createCloudBillingAccount(
      {
        name: "long-ids",
        provider: "generic_csv",
        credentials: {},
        config: {
          sampleCsv: `date,amount,external_id
2026-07-01,10.00,${prefix}-one-tail
2026-07-01,20.00,${prefix}-two-tail
`,
        },
      },
      null,
    );

    const result = await syncCloudBillingAccount(account.id, "2026-07");

    expect(result.imported).toBe(2);
    // Both rows survive: one entry per item, not one overwriting the other.
    expect(entryStore.size).toBe(2);
    const refs = Array.from(entryStore.values()).map((row) => row.sourceRef as string);
    expect(new Set(refs).size).toBe(2);
    for (const ref of refs) {
      expect(ref.length).toBeLessThanOrEqual(180);
    }
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
