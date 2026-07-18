import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		requireApiPermission: vi.fn(),
		listAuditLogs: vi.fn(),
	},
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/audit/service", () => ({ listAuditLogs: mocks.listAuditLogs }));

const route = await import("../route");

const session = { userId: "u1", username: "alice", user: { id: "u1" } };

const auditResult = {
	logs: [
		{ id: "log1", action: "user.login", severity: "INFO", actorType: "USER", actorId: "u1", detail: {}, createdAt: "2025-01-01T00:00:00.000Z", actor: { username: "alice", displayName: null } },
	],
	total: 1,
	page: 1,
	pageSize: 20,
	totalPages: 1,
};

describe("/api/audit GET", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireApiPermission.mockResolvedValue({ session });
		mocks.listAuditLogs.mockResolvedValue(auditResult);
	});

	it("requires audit:read and returns paginated logs", async () => {
		const res = await route.GET(new Request("http://local/api/audit?page=1&pageSize=20"));
		const json = await res.json();
		expect(res.status).toBe(200);
		expect(mocks.requireApiPermission).toHaveBeenCalledWith("audit:read");
		expect(mocks.listAuditLogs).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20, session }));
		expect(json).toEqual(auditResult);
	});

	it("passes action and severity filters to the service", async () => {
		mocks.listAuditLogs.mockResolvedValueOnce({ ...auditResult, logs: [] });
		const res = await route.GET(
			new Request("http://local/api/audit?action=user.login&severity=WARN&page=2&pageSize=5"),
		);
		expect(res.status).toBe(200);
		expect(mocks.listAuditLogs).toHaveBeenCalledWith(
			expect.objectContaining({ action: "user.login", severity: "WARN", page: 2, pageSize: 5 }),
		);
	});

	it("passes the search term to the service", async () => {
		await route.GET(new Request("http://local/api/audit?search=alice"));
		expect(mocks.listAuditLogs).toHaveBeenCalledWith(
			expect.objectContaining({ search: "alice" }),
		);
	});

	it("uses default page/pageSize when not supplied", async () => {
		await route.GET(new Request("http://local/api/audit"));
		expect(mocks.listAuditLogs).toHaveBeenCalledWith(
			expect.objectContaining({ page: 1, pageSize: 20 }),
		);
	});

	it("returns 403 when the caller lacks audit:read", async () => {
		mocks.requireApiPermission.mockResolvedValueOnce(
			new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
		);
		const res = await route.GET(new Request("http://local/api/audit"));
		expect(res.status).toBe(403);
		expect(mocks.listAuditLogs).not.toHaveBeenCalled();
	});
});
