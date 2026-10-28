import { describe, expect, it, vi } from "vitest";

/**
 * Every `include=remote` request used to open an SSH session (or queue an Agent job) for each visible server, so
 * polling by any account with server:read multiplied them. Callers asking about the same servers now share one sampling.
 */
const sampling = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/lib/monitoring/local-network", () => ({ readLocalNetworkDeviceStats: () => [] }));
vi.mock("@/lib/monitoring/remote-traffic", () => ({
	sampleRemoteServersTraffic: async () => { sampling.calls += 1; return []; },
}));
vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: vi.fn(async () => ({ session: { userId: "u1", roles: ["viewer"], currentTeamId: "team_1" } })),
}));
vi.mock("@/lib/db", () => ({
	prisma: {
		storageNode: { findMany: vi.fn(async () => []) },
		server: { findMany: vi.fn(async () => [{ id: "srv_b" }, { id: "srv_a" }]) },
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
});
