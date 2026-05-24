import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/api-session", () => ({
	requireApiSession: vi.fn(async () => ({ userId: "u1", roles: ["viewer"] })),
	isSessionPayload: vi.fn((value: unknown) => !((value as { status?: number })?.status)),
}));

vi.mock("@/lib/auth/authorization", () => ({
	sessionHasPermission: vi.fn(() => true),
}));

vi.mock("@/lib/db", () => ({
	prisma: {
		storageNode: {
			findMany: vi.fn(async () => [
				{ id: "local-storage", name: "本地存储", driver: "LOCAL", serverId: null, host: null, port: null, healthStatus: "HEALTHY" },
			]),
		},
		server: {
			findMany: vi.fn(async () => [{ id: "srv", name: "主机", host: "127.0.0.1", port: 22 }]),
		},
	},
}));

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		readFileSync: vi.fn(() => `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 10 1 0 0 0 0 0 0 20 1 0 0 0 0 0 0
  eth0: 4096 1 0 0 0 0 0 0 8192 1 0 0 0 0 0 0
`),
	};
});

import { GET } from "../route";

describe("traffic summary route", () => {
	it("returns current server traffic and storage node sources", async () => {
		const req = { nextUrl: new URL("http://localhost/api/traffic/summary") } as Parameters<typeof GET>[0];

		const response = await GET(req);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.currentServer.primaryInterface.iface).toBe("eth0");
		expect(body.currentServer.primaryInterface.rxLabel).toMatch(/B$/);
		expect(body.storageNodes[0]).toMatchObject({ id: "local-storage", trafficSource: "当前服务器" });
		expect(body.servers[0]).toMatchObject({ id: "srv", host: "127.0.0.1" });
	});
});
