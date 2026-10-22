import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * A request that also samples remote servers waits for them. It used to
 * summarize its local counters only afterwards: the older counters were
 * stored under the later time, over a newer poll's, so the next rates read
 * 0 and then a spike. Counters here grow by 1,000 bytes a second.
 */
const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);
const remote = vi.hoisted(() => ({ release: null as null | (() => void) }));

vi.mock("@/lib/monitoring/local-network", () => ({
	readLocalNetworkDeviceStats: () => {
		const elapsed = (Date.now() - T0) / 1000;
		return [{ iface: "eth0", rxBytes: 1_000 * elapsed, txBytes: 500 * elapsed }];
	},
}));
vi.mock("@/lib/monitoring/remote-traffic", () => ({
	sampleRemoteServersTraffic: () => new Promise((resolve) => { remote.release = () => resolve([]); }),
}));
vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: vi.fn(async () => ({ session: { userId: "u1", roles: ["viewer"] } })),
}));
vi.mock("@/lib/db", () => ({
	prisma: {
		storageNode: { findMany: vi.fn(async () => []) },
		server: { findMany: vi.fn(async () => []) },
		trafficSnapshot: { create: vi.fn(async () => ({ id: "snap" })) },
	},
}));

import { GET } from "../route";

const get = (query = "") => GET(new Request(`http://localhost/api/traffic/summary${query}`) as Parameters<typeof GET>[0]);
const rx = async (response: Promise<Response>) => (await (await response).json()).currentServer.primaryInterface.rxRateBytesPerSecond as number;

afterEach(() => vi.useRealTimers());

describe("traffic summary with slow remote sampling", () => {
	it("keeps the local rate steady while a remote sample is pending", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(T0);
		const slow = get("?include=remote");
		await vi.waitFor(() => expect(remote.release).not.toBeNull());

		vi.setSystemTime(T0 + 5_000);
		expect(await rx(get())).toBe(1_000);

		vi.setSystemTime(T0 + 10_000);
		remote.release!();
		await slow;

		vi.setSystemTime(T0 + 15_000);
		expect(await rx(get())).toBe(1_000);
	});
});
