import { describe, expect, it, vi } from "vitest";

/**
 * TR-037 R5+ validation tests for the new zod schema on
 * `/api/traffic/summary`. The pre-existing happy-path test lives in
 * `route.test.ts`; this file exercises the new failure paths
 * introduced by the zod wrapper.
 */

const { requireApiPermissionMock } = vi.hoisted(() => ({
	requireApiPermissionMock: vi.fn(async () => ({
		session: { userId: "u1", roles: ["viewer"] },
	})),
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: requireApiPermissionMock,
}));

vi.mock("@/lib/db", () => ({
	prisma: {
		storageNode: { findMany: vi.fn(async () => []) },
		server: { findMany: vi.fn(async () => []) },
	},
}));

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		readFileSync: vi.fn(
			() => `Inter-|   Receive                                                |  Transmit
face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
 lo: 10 1 0 0 0 0 0 0 20 1 0 0 0 0 0 0
eth0: 4096 1 0 0 0 0 0 0 8192 1 0 0 0 0 0 0
`,
		),
	};
});

import { GET } from "../route";

function makeReq(query: string) {
	const nextUrl = new URL(`http://localhost/api/traffic/summary${query}`);
	return {
		url: nextUrl.toString(),
		nextUrl,
	} as Parameters<typeof GET>[0];
}

describe("/api/traffic/summary zod validation (TR-037 R5+)", () => {
	it("rejects an empty iface (zod min(1) on the trimmed value)", async () => {
		const response = await GET(makeReq("?iface="));
		expect(response.status).toBe(400);
	});

	it("rejects an oversized iface (max 64 chars)", async () => {
		const response = await GET(makeReq(`?iface=${"x".repeat(80)}`));
		expect(response.status).toBe(400);
	});

	it("rejects an oversized include CSV (max 64 chars)", async () => {
		const response = await GET(makeReq(`?include=${"remote,".repeat(20)}`));
		expect(response.status).toBe(400);
	});

	it("still drops unknown include tokens silently (legacy contract)", async () => {
		const response = await GET(makeReq("?include=garbage,junk"));
		expect(response.status).toBe(200);
		const body = await response.json();
		// include=remote missing → no remote sampling → remoteServers stays null.
		expect(body.servers).toEqual([]);
	});

	it("accepts include=remote (the meaningful value)", async () => {
		const response = await GET(makeReq("?include=remote"));
		expect(response.status).toBe(200);
	});
});
