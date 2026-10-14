/** Status board management routes: platform administrators only, validated, audited, cache cleared. */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { customerSession, platformSession, routeSession } from "@/test/route-session-mock";

vi.mock("@/lib/auth/api-session", async () => {
	const { NextResponse } = await import("next/server");
	return {
		getApiSession: vi.fn(async () => routeSession.current),
		requireApiSession: vi.fn(async () => routeSession.current ?? NextResponse.json({ error: "unauthenticated" }, { status: 401 })),
		isSessionPayload: (value: unknown) => !(value instanceof Response),
	};
});
vi.mock("@/lib/http/rate-limit-presets", () => ({
	GENERAL_READ_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	GENERAL_WRITE_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));
const mocks = vi.hoisted(() => ({
	loadPublicSite: vi.fn(),
	savePublicSite: vi.fn(),
	listAdminNodes: vi.fn(),
	applyNodeBatch: vi.fn(),
	updateNodePublication: vi.fn(),
	invalidate: vi.fn(),
	clearHistory: vi.fn(),
	audit: vi.fn(),
}));
vi.mock("@/lib/public-status/site", () => ({ loadPublicSite: mocks.loadPublicSite, savePublicSite: mocks.savePublicSite }));
vi.mock("@/lib/public-status/nodes-admin", async (original) => ({
	...await original<typeof import("@/lib/public-status/nodes-admin")>(),
	listAdminNodes: mocks.listAdminNodes,
	applyNodeBatch: mocks.applyNodeBatch,
	updateNodePublication: mocks.updateNodePublication,
}));
vi.mock("@/lib/public-status/projection", () => ({ invalidatePublicStatusCache: mocks.invalidate }));
vi.mock("@/lib/public-status/read", () => ({ clearPublicHistoryCache: mocks.clearHistory }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.audit }));

const site = await import("../site/route");
const nodes = await import("../nodes/route");
const nodeItem = await import("../nodes/[serverId]/route");

const json = (method: string, url: string, body?: unknown) =>
	new Request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const SITE = { enabled: true, title: "T", description: null, announcement: null, defaultView: "cards", refreshSeconds: 15, accent: "default", metrics: ["cpu"], showPlatformStatus: true };
const NODE = { displayName: "Tokyo", groupName: null, region: null, tags: [], sortOrder: 0, note: null, maintenance: false, published: true };
const params = Promise.resolve({ serverId: "srv_1" });

describe("status board management routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = platformSession();
		mocks.loadPublicSite.mockResolvedValue({ ...SITE, enabled: false });
		mocks.savePublicSite.mockResolvedValue({ ...SITE, updatedAt: "x" });
		mocks.listAdminNodes.mockResolvedValue({ total: 0, rows: [] });
		mocks.applyNodeBatch.mockResolvedValue({ changed: 1, skipped: [] });
		mocks.updateNodePublication.mockResolvedValue({ publicId: "abcdefghijkl", published: true, wasPublished: false });
	});

	it("refuses anonymous callers and customer administrators on every verb", async () => {
		for (const session of [null, customerSession(["team:manage", "server:update", "health:read"])]) {
			routeSession.current = session;
			const statuses = [
				(await site.GET(json("GET", "http://local/api/admin/public-status/site"))).status,
				(await site.PUT(json("PUT", "http://local/api/admin/public-status/site", SITE))).status,
				(await nodes.GET(json("GET", "http://local/api/admin/public-status/nodes"))).status,
				(await nodes.POST(json("POST", "http://local/api/admin/public-status/nodes", { action: "publish", serverIds: ["srv_1"] }))).status,
				(await nodeItem.PUT(json("PUT", "http://local/api/admin/public-status/nodes/srv_1", NODE), { params })).status,
			];
			expect(statuses.every((status) => status === 401 || status === 403)).toBe(true);
		}
		expect(mocks.savePublicSite).not.toHaveBeenCalled();
		expect(mocks.applyNodeBatch).not.toHaveBeenCalled();
		expect(mocks.updateNodePublication).not.toHaveBeenCalled();
	});

	it("saves site settings, clears public caches and audits opening the board", async () => {
		const response = await site.PUT(json("PUT", "http://local/api/admin/public-status/site", SITE));
		expect(response.status).toBe(200);
		expect(mocks.savePublicSite).toHaveBeenCalledWith(SITE, "u_admin");
		expect(mocks.invalidate).toHaveBeenCalledTimes(1);
		expect(mocks.clearHistory).toHaveBeenCalledTimes(1);
		expect(mocks.audit).toHaveBeenCalledWith("u_admin", "public_status.site.update", expect.objectContaining({ enabledBefore: false, enabled: true }), "WARNING");
	});

	it("validates bodies strictly", async () => {
		expect((await site.PUT(json("PUT", "http://local/api/admin/public-status/site", { ...SITE, refreshSeconds: 1 }))).status).toBe(400);
		expect((await site.PUT(json("PUT", "http://local/api/admin/public-status/site", { ...SITE, extra: true }))).status).toBe(400);
		expect((await nodes.POST(json("POST", "http://local/api/admin/public-status/nodes", { action: "delete", serverIds: ["srv_1"] }))).status).toBe(400);
		expect((await nodes.POST(json("POST", "http://local/api/admin/public-status/nodes", { action: "publish", serverIds: Array.from({ length: 201 }, (_, i) => `s${i}`) }))).status).toBe(400);
		expect((await nodeItem.PUT(json("PUT", "http://local/api/admin/public-status/nodes/srv_1", { ...NODE, host: "1.2.3.4" }), { params })).status).toBe(400);
		expect((await nodes.GET(json("GET", "http://local/api/admin/public-status/nodes?pageSize=1000"))).status).toBe(400);
	});

	it("publishes a node, clears caches and records a publish audit", async () => {
		const response = await nodeItem.PUT(json("PUT", "http://local/api/admin/public-status/nodes/srv_1", NODE), { params });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ publicId: "abcdefghijkl", published: true });
		expect(mocks.updateNodePublication).toHaveBeenCalledWith("srv_1", NODE, "u_admin");
		expect(mocks.invalidate).toHaveBeenCalled();
		expect(mocks.audit).toHaveBeenCalledWith("u_admin", "public_status.node.publish", expect.objectContaining({ serverId: "srv_1" }), "WARNING");
	});

	it("batch revocation clears caches and is audited", async () => {
		const response = await nodes.POST(json("POST", "http://local/api/admin/public-status/nodes", { action: "unpublish", serverIds: ["srv_1"] }));
		expect(response.status).toBe(200);
		expect(mocks.invalidate).toHaveBeenCalled();
		expect(mocks.clearHistory).toHaveBeenCalled();
		expect(mocks.audit).toHaveBeenCalledWith("u_admin", "public_status.nodes.unpublish", expect.objectContaining({ changed: 1 }), "INFO");
	});

	it("lists with parsed paging", async () => {
		await nodes.GET(json("GET", "http://local/api/admin/public-status/nodes?q=tok&filter=attention&page=2&pageSize=10"));
		expect(mocks.listAdminNodes).toHaveBeenCalledWith({ q: "tok", filter: "attention", page: 2, pageSize: 10 });
	});
});
