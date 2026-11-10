import { expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({
  aggregate: vi.fn(async () => ({ _avg: { rxRateBps: 123, txRateBps: 456 }, _count: { _all: 1 } })),
  latest: vi.fn(async () => ({ source: "local", serverId: null, iface: "hub-private-iface", rxRateBps: 123, txRateBps: 456, sampledAt: new Date() })),
}));
vi.mock("@/lib/db", () => ({ prisma: { server: { findMany: async () => [] }, trafficSnapshot: { aggregate: s.aggregate, findFirst: s.latest } } }));
const { executeServerlessQuery } = await import("../hosted-safe-queries");
it("scopes customer traffic to visible servers without the Hub", async () => {
  await executeServerlessQuery({ actionType: "query_traffic", params: {} }, { userId: "u", roles: [], currentTeamId: "customer" });
  for (const query of [s.aggregate, s.latest]) {
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ serverId: { in: [] } }) }));
  }
});
