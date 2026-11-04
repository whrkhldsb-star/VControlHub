import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ checkRateLimitAsync: vi.fn(), handleInboundWebhook: vi.fn(), roleFindFirst: vi.fn(), userFindFirst: vi.fn() }));
vi.mock("@/lib/rate-limit", async (original) => ({ ...((await original()) as Record<string, unknown>), checkRateLimitAsync: mocks.checkRateLimitAsync, getClientIp: () => "203.0.113.9" }));
vi.mock("@/lib/itsm/service", () => ({ handleInboundWebhook: mocks.handleInboundWebhook }));
vi.mock("@/lib/db", () => ({ prisma: { role: { findFirst: mocks.roleFindFirst }, user: { findFirst: mocks.userFindFirst } } }));

const route = await import("../inbound/[connectionId]/route");
const post = (body: string | null, headers: Record<string, string> = {}) =>
	route.POST(new Request("http://local/api/itsm/inbound/conn_1", { method: "POST", headers: { "content-type": "application/json", ...headers }, body }), { params: Promise.resolve({ connectionId: "conn_1" }) });

describe("POST /api/itsm/inbound/[connectionId]", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.checkRateLimitAsync.mockResolvedValue({ allowed: true, retryAfterMs: 0 });
		mocks.roleFindFirst.mockResolvedValue({ id: "role_admin" });
		mocks.userFindFirst.mockResolvedValue({ id: "u_admin" });
		mocks.handleInboundWebhook.mockResolvedValue({ action: "created", ticketId: "t_1", event: { id: "ev_1", status: "ok" } });
	});

	it("hands the raw body, signature and oldest admin as system user to the service", async () => {
		const res = await post(JSON.stringify({ title: "Disk full" }), { "x-hub-signature-256": "sha256=abc" });
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true, action: "created", ticketId: "t_1", eventId: "ev_1" });
		// The system user is looked up by the service only after the signature verified (A8-08).
		expect(mocks.handleInboundWebhook).toHaveBeenCalledWith(expect.objectContaining({ connectionId: "conn_1", rawBody: '{"title":"Disk full"}', signatureHeader: "sha256=abc", json: { title: "Disk full" }, headers: expect.any(Headers), resolveSystemUserId: expect.any(Function) }));
		expect(mocks.userFindFirst).not.toHaveBeenCalled();
		const call = mocks.handleInboundWebhook.mock.calls[0]![0] as { resolveSystemUserId: () => Promise<string | null> };
		await expect(call.resolveSystemUserId()).resolves.toBe("u_admin");
		expect(mocks.userFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { roles: { some: { roleId: "role_admin" } } } }));
	});

	it("rate limits per connection and per IP, and rejects oversized or malformed bodies", async () => {
		mocks.checkRateLimitAsync.mockResolvedValueOnce({ allowed: true, retryAfterMs: 0 }).mockResolvedValueOnce({ allowed: false, retryAfterMs: 2500 });
		const limited = await post("{}");
		expect(limited.status).toBe(429);
		expect(limited.headers.get("retry-after")).toBe("3");
		expect((await post("{not json")).status).toBe(400);
		expect((await post("x".repeat(1024 * 1024 + 1))).status).toBe(413);
		expect(mocks.handleInboundWebhook).not.toHaveBeenCalled();
	});

	it("resolves no system user when no account exists (the service then answers 503)", async () => {
		mocks.roleFindFirst.mockResolvedValueOnce(null);
		mocks.userFindFirst.mockResolvedValueOnce(null);
		await post("{}");
		const call = mocks.handleInboundWebhook.mock.calls[0]![0] as { resolveSystemUserId: () => Promise<string | null> };
		await expect(call.resolveSystemUserId()).resolves.toBeNull();
	});
});
