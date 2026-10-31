import { Readable } from "node:stream";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
	GENERAL_READ_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const base = mkdtempSync(path.join(tmpdir(), "media-"));
writeFileSync(path.join(base, "clip.mp4"), "0123456789");
const mocks = vi.hoisted(() => ({ getMediaItem: vi.fn(), assertStorageAccess: vi.fn() }));
vi.mock("@/lib/storage/webdav-client", () => ({ createWebDavClient: () => ({ stat: async () => ({ size: 10, isDirectory: false }), stream: async (_path: string, range?: { start: number; end: number }) => Readable.toWeb(Readable.from([range ? "0123456789".slice(range.start, range.end + 1) : "0123456789"])) }) }));
vi.mock("@/lib/media/service", () => ({ getMediaItem: mocks.getMediaItem }));
vi.mock("@/lib/storage/access-control", () => ({ assertStorageAccess: mocks.assertStorageAccess }));

const route = await import("../[id]/stream/route");
const get = (headers: Record<string, string> = {}, query = "") => route.GET(new Request(`http://local/api/media/m_1/stream${query}`, { headers }), { params: Promise.resolve({ id: "m_1" }) });
const item = { id: "m_1", name: "clip.mp4", mimeType: "video/mp4", relativePath: "clip.mp4", storageNode: { id: "node_1", driver: "LOCAL", basePath: base } };

describe("GET /api/media/[id]/stream", () => {
	it("streams WebDAV media with full, range, invalid-range and download responses", async () => {
		mocks.getMediaItem.mockResolvedValue({ ...item, storageNode: { ...item.storageNode, driver: "WEBDAV", webdavConfigEncrypted: "fixture" } });
		const full = await get(); expect(full.status).toBe(200); expect(await full.text()).toBe("0123456789");
		const range = await get({ range: "bytes=2-4" }); expect(range.status).toBe(206); expect(range.headers.get("content-range")).toBe("bytes 2-4/10"); expect(await range.text()).toBe("234");
		expect((await get({ range: "bytes=99-100" })).status).toBe(416);
		expect((await get({}, "?download=1")).headers.get("content-disposition")).toContain("attachment");
	});
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = customerSession(["storage:read"]);
		mocks.getMediaItem.mockResolvedValue(item);
		mocks.assertStorageAccess.mockResolvedValue({ allowed: true });
	});

	it("needs storage:read, a visible item and read access to its node path", async () => {
		routeSession.current = customerSession(["server:read"]);
		expect((await get()).status).toBe(403);
		routeSession.current = customerSession(["storage:read"]);
		mocks.getMediaItem.mockResolvedValueOnce(null);
		expect((await get()).status).toBe(404);
		expect(mocks.getMediaItem).toHaveBeenCalledWith("m_1", expect.objectContaining({ currentTeamId: "team_1" }), { includeCredentials: true });
		mocks.assertStorageAccess.mockResolvedValueOnce({ allowed: false, reason: "no-access" });
		expect((await get()).status).toBe(403);
		expect(mocks.assertStorageAccess).toHaveBeenCalledWith(expect.objectContaining({ storageNodeId: "node_1", relativePath: "clip.mp4", operation: "read" }));
	});

	it("streams a local file whole or by byte range, and as an attachment on download=1", async () => {
		const whole = await get();
		expect(whole.status).toBe(200);
		expect(whole.headers.get("content-type")).toBe("video/mp4");
		expect(await whole.text()).toBe("0123456789");
		const partial = await get({ range: "bytes=2-4" });
		expect(partial.status).toBe(206);
		expect(partial.headers.get("content-range")).toBe("bytes 2-4/10");
		expect(await partial.text()).toBe("234");
		expect((await get({ range: "bytes=50-60" })).status).toBe(416);
		const download = await get({}, "?download=1");
		expect(download.headers.get("content-disposition")).toContain("attachment");
	});

	it("refuses paths that escape the node root and unsupported drivers", async () => {
		mocks.getMediaItem.mockResolvedValueOnce({ ...item, relativePath: "../outside.mp4" });
		expect((await get()).status).toBe(400);
		mocks.getMediaItem.mockResolvedValueOnce({ ...item, relativePath: "missing.mp4" });
		expect((await get()).status).toBe(404);
		mocks.getMediaItem.mockResolvedValueOnce({ ...item, storageNode: { ...item.storageNode, driver: "UNSUPPORTED" } });
		expect((await get()).status).toBe(400);
	});
});
