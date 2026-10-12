import { beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";

import { ForbiddenError, NotFoundError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
	withRateLimit: vi.fn(), resolveShareToken: vi.fn(), authorizeShareDownload: vi.fn(), releaseShareQuotaClaim: vi.fn(),
	assertShareTargetNotDeleted: vi.fn(), streamStorageFile: vi.fn(),
}));
vi.mock("@/lib/http/rate-limit-presets", async (original) => ({ ...((await original()) as Record<string, unknown>), withRateLimit: mocks.withRateLimit }));
vi.mock("@/lib/share-link/service", async (original) => ({
	...((await original()) as Record<string, unknown>),
	resolveShareToken: mocks.resolveShareToken, authorizeShareDownload: mocks.authorizeShareDownload,
	releaseShareQuotaClaim: mocks.releaseShareQuotaClaim, assertShareTargetNotDeleted: mocks.assertShareTargetNotDeleted,
}));
vi.mock("@/lib/storage/file-content", async (original) => ({ ...((await original()) as Record<string, unknown>), streamStorageFile: mocks.streamStorageFile }));

const route = await import("../[token]/route");
const TOKEN = "share-token-0123456789";
const get = (query = "", headers: Record<string, string> = {}) => route.GET(new Request(`http://local/api/share/${TOKEN}${query}`, { headers }), { params: Promise.resolve({ token: TOKEN }) });
const post = (body: unknown) => route.POST(new Request(`http://local/api/share/${TOKEN}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ token: TOKEN }) });
const webdavNode = { id: "node_1", driver: "WEBDAV", basePath: "/", name: "dav" };
const fileShare = { id: "sh_1", name: "a.txt", path: "docs/a.txt", entryType: "FILE", storageNodeId: "node_1", storageNode: webdavNode };
const dirShare = { ...fileShare, name: "docs", path: "docs", entryType: "DIRECTORY" };

describe("/api/share/[token]", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.withRateLimit.mockResolvedValue({ allowed: true, retryAfterMs: 0 });
		mocks.resolveShareToken.mockResolvedValue(fileShare);
		mocks.assertShareTargetNotDeleted.mockResolvedValue(undefined);
		mocks.authorizeShareDownload.mockResolvedValue({ id: "sh_1" });
		mocks.streamStorageFile.mockResolvedValue({ stream: Readable.from([Buffer.from("hello")]), close: vi.fn() });
	});

	it("rejects short tokens and rate-limited callers before touching the share", async () => {
		expect((await route.GET(new Request("http://local/api/share/abc"), { params: Promise.resolve({ token: "abc" }) })).status).toBe(400);
		mocks.withRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterMs: 1000 });
		expect((await get()).status).toBe(429);
		expect(mocks.resolveShareToken).not.toHaveBeenCalled();
	});

	it("maps resolve failures to 403 for a wrong password and 404 for everything else", async () => {
		mocks.resolveShareToken.mockRejectedValueOnce(new ForbiddenError("password"));
		expect((await get("", { "x-share-password": "nope" })).status).toBe(403);
		// Only the per-token limiter goes through withRateLimit; password guesses are
		// keyed directly on share + client address (see checkSharePasswordRateLimit).
		expect(mocks.withRateLimit).toHaveBeenCalledTimes(1);
		mocks.resolveShareToken.mockRejectedValueOnce(new NotFoundError("expired"));
		expect((await get()).status).toBe(404);
	});

	it("streams a shared file from a WebDAV node and keeps the quota claim", async () => {
		const res = await get();
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("hello");
		expect(res.headers.get("content-disposition")).toContain("a.txt");
		expect(mocks.streamStorageFile).toHaveBeenCalledWith(webdavNode, "docs/a.txt");
		expect(mocks.releaseShareQuotaClaim).not.toHaveBeenCalled();
	});

	it("releases the quota claim when a directory share is misused", async () => {
		mocks.resolveShareToken.mockResolvedValue(dirShare);
		expect((await get()).status).toBe(400);
		expect((await get("?path=other/secret.txt")).status).toBe(403);
		expect((await get("?path=../../etc/passwd")).status).toBe(400);
		expect((await get("?archive=1")).status).toBe(400);
		expect(mocks.releaseShareQuotaClaim).toHaveBeenCalledTimes(4);
		expect(mocks.releaseShareQuotaClaim).toHaveBeenCalledWith("sh_1");
		expect(mocks.streamStorageFile).not.toHaveBeenCalled();
	});

	it("serves a child of a directory share and 404s a target that was since deleted", async () => {
		mocks.resolveShareToken.mockResolvedValue(dirShare);
		const res = await get("?path=docs/b.txt");
		expect(res.status).toBe(200);
		expect(mocks.streamStorageFile).toHaveBeenCalledWith(webdavNode, "docs/b.txt");
		mocks.assertShareTargetNotDeleted.mockRejectedValueOnce(new Error("deleted"));
		expect((await get("?path=docs/b.txt")).status).toBe(404);
		expect(mocks.releaseShareQuotaClaim).toHaveBeenCalledWith("sh_1");
	});

	it("exchanges a password for a download-ticket cookie and never leaks it on failure", async () => {
		const ok = await post({ password: "s3cret" });
		expect(ok.status).toBe(200);
		expect(ok.headers.get("set-cookie")).toMatch(/HttpOnly/i);
		expect(ok.headers.get("cache-control")).toBe("no-store");
		expect(mocks.authorizeShareDownload).toHaveBeenCalledWith(TOKEN, "s3cret", expect.any(Object));
		expect((await post({})).status).toBe(400);
		mocks.authorizeShareDownload.mockRejectedValueOnce(new ForbiddenError("wrong"));
		const denied = await post({ password: "wrong" });
		expect(denied.status).toBe(403);
		expect(denied.headers.get("set-cookie")).toBeNull();
	});
});
