import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		requireApiPermission: vi.fn(),
		exportAuditLogs: vi.fn(),
	},
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/audit/service", () => ({ exportAuditLogs: mocks.exportAuditLogs }));

const route = await import("../route");

const session = { userId: "u1", username: "alice", user: { id: "u1" } };

const sampleLogs = [
	{
		id: "log1",
		actorType: "USER",
		actorId: "u1",
		action: "user.login",
		severity: "INFO",
		detail: { ip: "1.2.3.4" },
		createdAt: new Date("2025-01-01T00:00:00Z"),
		actor: { username: "alice", displayName: null },
	},
	{
		id: "log2",
		actorType: "SYSTEM",
		actorId: null,
		action: "deploy.rollback",
		severity: "WARN",
		detail: {},
		createdAt: new Date("2025-01-02T12:00:00Z"),
		actor: null,
	},
];

describe("/api/audit/export GET", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireApiPermission.mockResolvedValue({ session });
		mocks.exportAuditLogs.mockResolvedValue(sampleLogs);
	});

	it("requires audit:read and returns CSV by default", async () => {
		const res = await route.GET(new Request("http://local/api/audit/export"));
		expect(res.status).toBe(200);
		expect(mocks.requireApiPermission).toHaveBeenCalledWith("audit:read");
		expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
		expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="audit-export-/);
		const text = await res.text();
		expect(text).toContain("Timestamp,Action,Severity,Actor,Actor Type,Details");
		expect(text).toContain("user.login");
		expect(text).toContain("deploy.rollback");
		expect(text).toContain("ip=1.2.3.4");
	});

	it("returns JSON when format=json", async () => {
		const res = await route.GET(new Request("http://local/api/audit/export?format=json"));
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/json");
		const json = await res.json();
		expect(json).toHaveLength(2);
		expect(json[0].action).toBe("user.login");
	});

	it("CSV-escapes fields containing commas", async () => {
		mocks.exportAuditLogs.mockResolvedValueOnce([
			{
				id: "log-csv",
				actorType: "USER",
				actorId: "u1",
				action: "login,success",
				severity: "INFO",
				detail: {},
				createdAt: new Date("2025-01-01T00:00:00Z"),
				actor: { username: "bob", displayName: null },
			},
		]);
		const res = await route.GET(new Request("http://local/api/audit/export?format=csv"));
		const text = await res.text();
		// Field with a comma must be quoted
		expect(text).toContain('"login,success"');
	});

	it("CSV-escapes fields containing double quotes by doubling them", async () => {
		mocks.exportAuditLogs.mockResolvedValueOnce([
			{
				id: "log-q",
				actorType: "USER",
				actorId: "u1",
				action: 'say "hi"',
				severity: "INFO",
				detail: {},
				createdAt: new Date("2025-01-01T00:00:00Z"),
				actor: { username: "bob", displayName: 'Bob "The Admin"' },
			},
		]);
		const res = await route.GET(new Request("http://local/api/audit/export?format=csv"));
		const text = await res.text();
		// Quotes inside a field are doubled and the field is wrapped in quotes
		expect(text).toContain('"say ""hi"""');
		expect(text).toContain('"Bob ""The Admin"""');
	});

	it("passes action/severity/search filters to the service", async () => {
		await route.GET(
			new Request("http://local/api/audit/export?action=user.login&severity=WARN&search=alice"),
		);
		expect(mocks.exportAuditLogs).toHaveBeenCalledWith({
			action: "user.login",
			severity: "WARN",
			search: "alice",
			session,
		});
	});

	it("returns 403 when the caller lacks audit:read", async () => {
		mocks.requireApiPermission.mockResolvedValueOnce(
			new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
		);
		const res = await route.GET(new Request("http://local/api/audit/export"));
		expect(res.status).toBe(403);
		expect(mocks.exportAuditLogs).not.toHaveBeenCalled();
	});
});
