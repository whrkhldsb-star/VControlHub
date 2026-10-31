import { expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ query: vi.fn(async () => [{ source: "local", serverId: null, iface: "hub-private-iface", rxRateBps: 123, txRateBps: 456, sampledAt: new Date() }]) }));
vi.mock("@/lib/db", () => ({ prisma: { server: { findMany: async () => [] }, trafficSnapshot: { findMany: s.query } } }));
const { executeServerlessQuery } = await import("../hosted-safe-queries");
it("scopes customer traffic to visible servers without the Hub", async () => {
  await executeServerlessQuery({ actionType: "query_traffic", params: {} }, { userId: "u", roles: [], currentTeamId: "customer" });
  expect(s.query).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ serverId: { in: [] } }) }));
});
