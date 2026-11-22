import { describe, expect, it, vi } from "vitest";

/**
 * Every `include=remote` request used to open an SSH session (or queue an Agent job) for each visible server, so
 * polling by any account with server:read multiplied them. Callers asking about the same servers now share one sampling.
 */
const sampling = vi.hoisted(() => ({ calls: 0, servers: vi.fn(async () => [{ id: "srv_b" }, { id: "srv_a" }]) }));

vi.mock("@/lib/monitoring/local-network", () => ({ readLocalNetworkDeviceStats: () => [] }));
vi.mock("@/lib/monitoring/remote-traffic", () => ({
	sampleRemoteServersTraffic: async () => { sampling.calls += 1; return [{ serverId: "srv_b", serverName: "old name", host: "old host" }, { serverId: "srv_a" }]; },
}));
vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: vi.fn(async () => ({ session: { userId: "u1", roles: ["viewer"], currentTeamId: "team_1" } })),
}));
vi.mock("@/lib/db", () => ({
	prisma: {
		storageNode: { findMany: vi.fn(async () => []) },
		server: { findMany: sampling.servers },
		trafficSnapshot: { create: vi.fn(async () => ({ id: "snap" })) },
	},
}));

import { GET } from "../route";

const get = () => GET(new Request("http://localhost/api/traffic/summary?include=remote") as Parameters<typeof GET>[0]);

describe("traffic summary remote sampling is shared", () => {
	it("samples the visible servers once for callers that poll together or one after another", async () => {
		await Promise.all([get(), get(), get()]);
		await get();
		expect(sampling.calls).toBe(1);
	});
	it("filters cached readings and metadata against the final server grant", async () => {
		await get();
		const count = sampling.calls;
		sampling.servers.mockResolvedValueOnce([{ id: "srv_b" }, { id: "srv_a" }]).mockResolvedValueOnce([{ id: "srv_a" }]);
		const result = await (await get()).json();
		expect(sampling.calls).toBe(count);
		expect(result.servers).toEqual([{ id: "srv_a" }]);
		expect(result.remoteServers).toEqual([{ serverId: "srv_a" }]);
	});

});
