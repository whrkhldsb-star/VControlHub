import { beforeEach, describe, expect, it, vi } from "vitest";

import { ValidationError } from "@/lib/errors";
import { customerSession, routeSession } from "@/test/route-session-mock";

vi.mock("@/lib/auth/api-session", async () => {
	const { NextResponse } = await import("next/server");
	const unauthenticated = () => NextResponse.json({ error: "unauthenticated" }, { status: 401 });
	return {
		getApiSession: vi.fn(async () => routeSession.current),
		requireApiSession: vi.fn(async () => routeSession.current ?? unauthenticated()),
		isSessionPayload: (value: unknown) => !(value instanceof Response),
	};
});
vi.mock("@/lib/http/rate-limit-presets", () => ({
	GENERAL_WRITE_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	GENERAL_READ_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	UPLOAD_CHUNK_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	AGENT_POLL_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const mocks = vi.hoisted(() => ({ completeStorageFileUpload: vi.fn(), auditUserAction: vi.fn(), getStorageFileNode: vi.fn(), assertStorageAccess: vi.fn(), fileEntryFindFirst: vi.fn(), transport: vi.fn() }));
vi.mock("@/lib/storage/resumable-upload", async (original) => ({ ...((await original()) as Record<string, unknown>), completeStorageFileUpload: mocks.completeStorageFileUpload }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));
vi.mock("@/lib/db", () => ({ prisma: { fileEntry: { findFirst: mocks.fileEntryFindFirst } } }));

vi.mock("@/lib/storage/file-content", () => ({ getStorageFileNode: mocks.getStorageFileNode }));
vi.mock("@/lib/storage/access-control", () => ({ assertStorageAccess: mocks.assertStorageAccess }));
vi.mock("@/lib/storage/webdav-client", async (original) => {
	const client = await original<typeof import("@/lib/storage/webdav-client")>();
	return { ...client, createWebDavClient: (node: Parameters<typeof client.createWebDavClient>[0]) =>
		client.createWebDavClient(node, { transport: mocks.transport }) };
});

const complete = await import("../upload/[id]/complete/route");

describe("POST /api/storage/upload/[id]/complete", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = customerSession(["storage:write"]);
		mocks.completeStorageFileUpload.mockResolvedValue({ session: { id: "up_1", status: "COMPLETED" }, relativePath: "docs/a.txt", size: 12, storageNodeId: "node_1" });
	});

	it("needs storage:write", async () => {
		routeSession.current = customerSession(["storage:read"]);
		expect((await complete.POST(new Request("http://local/x", { method: "POST" }), { params: Promise.resolve({ id: "up_1" }) })).status).toBe(403);
		expect(mocks.completeStorageFileUpload).not.toHaveBeenCalled();
	});

	it("finalises the caller's own session, indexes it and audits the result", async () => {
		const res = await complete.POST(new Request("http://local/x", { method: "POST" }), { params: Promise.resolve({ id: "up_1" }) });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ session: { id: "up_1", status: "COMPLETED" }, relativePath: "docs/a.txt", size: 12, storageNodeId: "node_1" });
		expect(mocks.completeStorageFileUpload).toHaveBeenCalledWith({ sessionId: "up_1", session: expect.objectContaining({ userId: "u_cust", currentTeamId: "team_1" }) });
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_cust", "storage.upload.complete", expect.objectContaining({ sessionId: "up_1", storageNodeId: "node_1", size: 12 }), "INFO", "team_1");
		mocks.completeStorageFileUpload.mockRejectedValueOnce(new ValidationError("missing chunks"));
		expect((await complete.POST(new Request("http://local/x", { method: "POST" }), { params: Promise.resolve({ id: "up_1" }) })).status).toBe(400);
	});
});

const { GET } = await import("../webdav-download/route");
const { encryptWebDavConfig } = await import("@/lib/storage/webdav-credentials");

describe("GET /api/storage/webdav-download", () => {
	const url = "http://local/api/storage/webdav-download?nodeId=node_1&path=file.txt";
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = customerSession(["storage:read"]);
		mocks.getStorageFileNode.mockResolvedValue({ id: "node_1", driver: "WEBDAV", basePath: "/root",
			webdavConfigEncrypted: encryptWebDavConfig({ endpoint: "https://fixture.example/dav", authType: "bearer", token: "fixture" }) });
		mocks.assertStorageAccess.mockResolvedValue({ allowed: true });
		mocks.fileEntryFindFirst.mockResolvedValue(null);
		const metadata = '<multistatus><response><href>/dav/root/file.txt</href><propstat><status>HTTP/1.1 200 OK</status><prop><getcontentlength>6</getcontentlength></prop></propstat></response></multistatus>';
		mocks.transport.mockResolvedValueOnce(new Response(metadata, { status: 207 }));
	});
	it.each([false, true])("uses one stat for response headers and body (range=%s)", async partial => {
		const body = partial ? "bcd" : "abcdef";
		const headers = new Headers({ "content-length": String(body.length) });
		if (partial) headers.set("content-range", "bytes 1-3/6");
		mocks.transport.mockResolvedValueOnce(new Response(body, { status: partial ? 206 : 200, headers }));
		const response = await GET(new Request(url, { headers: partial ? { range: "bytes=1-3" } : {} }));
		expect(response.status).toBe(partial ? 206 : 200);
		expect(response.headers.get("content-range")).toBe(partial ? "bytes 1-3/6" : null);
		expect(response.headers.get("content-length")).toBe(String(body.length));
		expect(await response.text()).toBe(body);
		expect(mocks.transport.mock.calls.map(([, init]) => init.method)).toEqual(["PROPFIND", "GET"]);
	});
	it("rejects a replacement of a different size before sending a successful response", async () => {
		mocks.transport.mockResolvedValueOnce(new Response("changed", { headers: { "content-length": "7" } }));
		expect((await GET(new Request(url))).status).toBeGreaterThanOrEqual(400);
		expect(mocks.transport.mock.calls.map(([, init]) => init.method)).toEqual(["PROPFIND", "GET"]);
	});
});
