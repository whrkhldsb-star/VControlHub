import { expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ cursor: 0, writes: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>, now: Date.now(), sql: [] as string[], values: [] as unknown[][] }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { if (strings.join("?").includes("FOR SHARE")) return [{ id: "s" }]; s.sql.push(strings.join("?")); s.values.push(values); return []; }, serverAgentJob: {
  findFirst: async () => s.cursor < 21 ? { id: `stale-${s.cursor}`, serverId: "s", status: "PENDING", command: "audit-fixture-only", timeoutMs: 1000, createdAt: new Date(s.now - 600000) } : null,
  updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => { s.writes.push(args); if (args.where.id && args.data.status === "CANCELLED") s.cursor++; return { count: args.where.id ? 1 : 0 }; },
} }) } }));
vi.mock("@/lib/ssh/client", () => ({ buildSshParamsFromServer: vi.fn(), execRemoteCommand: vi.fn() }));
const { claimNextServerAgentJob } = await import("../agent-service");
const { DB_UTC_NOW } = await import("@/lib/db/utc-now");
it("never dispatches the expired entry after the bounded sweep", async () => {
  const job = await claimNextServerAgentJob("s", "digest");
  expect(job).toBeNull();
  expect(s.writes.filter((w) => w.data.status === "CANCELLED" && w.where.id)).toHaveLength(20);
  expect(s.writes.some((write) => write.data.status === "CLAIMED")).toBe(false);
});
// "createdAt" holds UTC wall time. Compared with a bare now() (a timestamptz) it is read in the session's zone, and
// on a database set to Asia/Shanghai every job with less than eight hours to live looked expired.
it("looks past the backlog with the job's age measured against UTC wall time", () => {
  expect(s.sql).toHaveLength(1);
  // The clock is the shared DB_UTC_NOW fragment, (NOW() AT TIME ZONE 'UTC'), bound as the last value after ">".
  expect(s.sql[0]).toMatch(/> \?\s*ORDER BY/);
  expect(s.values[0]!.at(-1)).toBe(DB_UTC_NOW);
  expect(s.sql[0]).not.toMatch(/now\(\)/i);
});
