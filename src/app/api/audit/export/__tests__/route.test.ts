import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		requireApiPermission: vi.fn(),
		exportAuditLogs: vi.fn(),
		prepareAuditExport: vi.fn(),
	},
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/audit/service", () => ({
	exportAuditLogs: mocks.exportAuditLogs,
	prepareAuditExport: mocks.prepareAuditExport,
	AUDIT_EXPORT_MAX_ROWS: 100_000,
}));

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
		severity: "WARNING",
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
		// CSV streams in batches (A8-09); the batches come from the same fixture the JSON export returns.
		mocks.prepareAuditExport.mockImplementation((filter: unknown) => ({
			truncated: false,
			batches: (async function* () { yield await mocks.exportAuditLogs(filter); })(),
		}));
	});

	it("requires audit:read and returns CSV by default", async () => {
		const res = await route.GET(new Request("http://local/api/audit/export"));
		expect(res.status).toBe(200);
		expect(mocks.requireApiPermission).toHaveBeenCalledWith("audit:read");
		expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
		expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="audit-export-/);
		const text = await res.text();
		expect(text).toMatch(/Timestamp,Action,Severity,Actor,Actor Type,Details|时间,操作,级别,操作者,操作者类型,详情/);
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
			new Request("http://local/api/audit/export?action=user.login&severity=WARNING&search=alice"),
		);
		expect(mocks.prepareAuditExport).toHaveBeenCalledWith({
			action: "user.login",
			severity: "WARNING",
			search: "alice",
			session,
		}, expect.anything());
	});

	it("serialises nested detail values instead of [object Object]", async () => {
		mocks.exportAuditLogs.mockResolvedValueOnce([
			{
				id: "log-nested",
				actorType: "SYSTEM",
				actorId: null,
				action: "playbook.trigger.metric",
				severity: "INFO",
				// Audit details routinely nest — metric readings, step lists, zod issues.
				detail: { readings: [{ serverId: "s1", value: 91 }] },
				createdAt: new Date("2025-01-01T00:00:00Z"),
				actor: null,
			},
		]);
		const res = await route.GET(new Request("http://local/api/audit/export"));
		const text = await res.text();
		expect(text).not.toContain("[object Object]");
		expect(text).toContain('serverId');
		expect(text).toContain("91");
	});

	it.each(["csv", "json"])("reads %s batches only on demand and stops on cancellation", async (format) => {
		const next = vi.fn(async () => ({ done: false, value: sampleLogs }));
		const close = vi.fn();
		mocks.prepareAuditExport.mockResolvedValueOnce({ truncated: true, batches: { next, return: close } });
		const response = await route.GET(new Request(`http://local/api/audit/export?format=${format}`));
		if (format === "json") expect(response.headers.get("x-audit-export-truncated")).toBe("true");
		const reader = response.body!.getReader();
		await reader.read(); // prefix
		expect(next).not.toHaveBeenCalled();
		await reader.read();
		expect(next).toHaveBeenCalledOnce();
		await reader.cancel();
		expect(close).toHaveBeenCalledOnce();
		expect(next).toHaveBeenCalledOnce();
	});

	it("ends a disconnected request while its one outstanding page is still being read", async () => {
		const signal = new AbortController();
		const page = Promise.withResolvers<{ done: boolean; value: typeof sampleLogs }>();
		const next = vi.fn(() => page.promise);
		const close = vi.fn(async () => ({ done: true }));
		mocks.prepareAuditExport.mockResolvedValueOnce({ truncated: false, batches: { next, return: close } });
		const response = await route.GET(new Request("http://local/api/audit/export?format=json", { signal: signal.signal }));
		const reader = response.body!.getReader();
		await reader.read();
		const reading = reader.read();
		await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
		signal.abort();
		await expect(reading).rejects.toMatchObject({ name: "AbortError" });
		expect(close).toHaveBeenCalledOnce();
		page.resolve({ done: false, value: sampleLogs });
		await expect(reader.read()).rejects.toMatchObject({ name: "AbortError" });
		expect(next).toHaveBeenCalledOnce();
	});

	it("rejects an unsupported format with 400 rather than 500", async () => {
		const res = await route.GET(
			new Request("http://local/api/audit/export?format=xml"),
		);
		// The guard's querySchema turns this into a client error; a bare
		// schema.parse() in the handler would surface it as 500 "Operation failed".
		expect(res.status).toBe(400);
		expect(mocks.exportAuditLogs).not.toHaveBeenCalled();
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
