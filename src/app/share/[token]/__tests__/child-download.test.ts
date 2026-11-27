import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), get: vi.fn(), head: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { shareLink: { findUnique: mocks.lookup } } }));
vi.mock("@/lib/http/rate-limit-presets", () => ({ withRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/share-link/service", () => ({ hashShareToken: (token: string) => `hash:${token}` }));
vi.mock("@/app/api/share/[token]/route", () => ({ GET: mocks.get, HEAD: mocks.head }));
import { GET, HEAD } from "@/app/api/share/[token]/files/route";

const context = { params: Promise.resolve({ token: "share-token" }) };
beforeEach(() => {
	vi.resetAllMocks();
	mocks.lookup.mockResolvedValue({ entryType: "DIRECTORY", path: "internal/root" });
});

it("leaves ticket checks, range requests, sandbox CSP, and HEAD quota semantics with the existing handler", async () => {
	const response = new Response(null, { status: 200, headers: { "Content-Security-Policy": "sandbox; default-src 'none'" } });
	mocks.head.mockResolvedValue(response);
	const req = new Request("https://hub/api/share/share-token/files?file=sub%2Fa.txt&inline=1&archive=1", { method: "HEAD", headers: { cookie: "share_ticket=test", range: "bytes=0-5" } });
	const res = await HEAD(req, context);
	expect(res).toBe(response);
	expect(res.headers.get("Content-Security-Policy")).toContain("sandbox");
	const forwarded = mocks.head.mock.calls[0]![0] as Request;
	expect(new URL(forwarded.url).searchParams.get("path")).toBe("internal/root/sub/a.txt");
	expect(new URL(forwarded.url).searchParams.has("archive")).toBe(false);
	expect(forwarded.headers.get("cookie")).toBe("share_ticket=test");
	expect(forwarded.headers.get("range")).toBe("bytes=0-5");
	expect(mocks.get).not.toHaveBeenCalled();
});

it("rejects a non-child without initiating a download", async () => {
	const response = await GET(new Request("https://hub/api/share/share-token/files?file=..%2Fprivate"), context);
	expect(response.status).toBe(404);
	expect(mocks.get).not.toHaveBeenCalled();
});
