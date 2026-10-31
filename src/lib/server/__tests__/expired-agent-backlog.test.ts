import { expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ cursor: 0, writes: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>, now: Date.now() }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ serverAgentJob: {
  findFirst: async () => s.cursor < 21 ? { id: `stale-${s.cursor}`, serverId: "s", status: "PENDING", command: "audit-fixture-only", timeoutMs: 1000, createdAt: new Date(s.now - 600000) } : null,
  updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => { s.writes.push(args); if (args.where.id && args.data.status === "CANCELLED") s.cursor++; return { count: args.where.id ? 1 : 0 }; },
} }) } }));
vi.mock("@/lib/ssh/client", () => ({ buildSshParamsFromServer: vi.fn(), execRemoteCommand: vi.fn() }));
const { claimNextServerAgentJob } = await import("../agent-service");
it("never dispatches the expired entry after the bounded sweep", async () => {
  const job = await claimNextServerAgentJob("s");
  expect(job).toBeNull();
  expect(s.writes.filter((w) => w.data.status === "CANCELLED" && w.where.id)).toHaveLength(20);
  expect(s.writes.some((write) => write.data.status === "CLAIMED")).toBe(false);
});
