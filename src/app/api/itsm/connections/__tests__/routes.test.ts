import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract tests for the three ITSM connection routes.
 *
 * These rows hold encrypted outbound credentials and a webhook URL the platform
 * will POST to, so the route-level properties are: every method sits behind
 * `ticket:manage`, the response never carries the plaintext credentials back,
 * and the connectivity probe reports a failed delivery as 502 rather than
 * `200 { ok: false }`. Who may set `teamId` is decided by
 * `resolveConnectionTeamId` in the service (admins only) and covered by
 * `src/lib/itsm/__tests__/team-scope.test.ts`; SSRF on the webhook URL is
 * enforced at send time by `fetchWebhookSafely`.
 */
const mocks = vi.hoisted(() => ({
	listItsmConnections: vi.fn(),
	createItsmConnection: vi.fn(),
	getItsmConnection: vi.fn(),
	updateItsmConnection: vi.fn(),
	deleteItsmConnection: vi.fn(),
	testItsmConnection: vi.fn(),
	auditUserAction: vi.fn(),
	guardCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/itsm/service", () => ({
	listItsmConnections: mocks.listItsmConnections,
	createItsmConnection: mocks.createItsmConnection,
	getItsmConnection: mocks.getItsmConnection,
	updateItsmConnection: mocks.updateItsmConnection,
	deleteItsmConnection: mocks.deleteItsmConnection,
	testItsmConnection: mocks.testItsmConnection,
}));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

vi.mock("@/lib/http/api-guard", () => ({
	withApiRoute: vi.fn(async (request: Request, options: any, handler: any) => {
		mocks.guardCalls.push(options);
		let body: unknown = undefined;
		if (options.bodySchema) {
			const raw = await request.clone().json().catch(() => undefined);
			const parsed = options.bodySchema.safeParse(raw);
			if (!parsed.success) return Response.json({ error: "输入参数无效" }, { status: 400 });
			body = parsed.data;
		}
		try {
			return await handler({ session, body });
		} catch (error) {
			// Mirror the real guard: an AppError keeps its own status.
			const status = (error as { status?: number }).status ?? options.errorStatus ?? 500;
			return Response.json({ error: (error as Error).message }, { status });
		}
	}),
}));

const session = {
	userId: "u_1",
	username: "op",
	roles: ["operator"],
	mustChangePassword: false,
	currentTeamId: "team_1",
};

const collection = await import("../route");
const item = await import("../[id]/route");
const probe = await import("../[id]/test/route");

const idParams = { params: Promise.resolve({ id: "conn_1" }) };

function req(method: string, body?: unknown) {
	return new Request("https://a.test/api/itsm/connections", {
		method,
		headers: { "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

// What the service returns: a view with `hasCredentials`, never the plaintext.
const connectionView = {
	id: "conn_1",
	name: "ops-slack",
	provider: "slack",
	direction: "bidirectional",
	enabled: true,
	teamId: "team_1",
	config: { webhookUrl: "https://hooks.example.com/T/B/X" },
	hasCredentials: true,
};

function createBody(overrides: Record<string, unknown> = {}) {
	return {
		name: "ops-slack",
		provider: "slack",
		credentials: { webhookSecret: "s3cr3t-signing-key" },
		config: { webhookUrl: "https://hooks.example.com/T/B/X" },
		...overrides,
	};
}

describe("ITSM connection routes", () => {
	beforeEach(() => {
		for (const stub of [
			mocks.listItsmConnections,
			mocks.createItsmConnection,
			mocks.getItsmConnection,
			mocks.updateItsmConnection,
			mocks.deleteItsmConnection,
			mocks.testItsmConnection,
			mocks.auditUserAction,
		]) {
			stub.mockReset();
		}
		mocks.guardCalls.length = 0;
		mocks.listItsmConnections.mockResolvedValue([connectionView]);
		mocks.createItsmConnection.mockResolvedValue(connectionView);
		mocks.getItsmConnection.mockResolvedValue(connectionView);
		mocks.updateItsmConnection.mockResolvedValue(connectionView);
		mocks.deleteItsmConnection.mockResolvedValue(undefined);
		mocks.testItsmConnection.mockResolvedValue({
			ok: true,
			event: { id: "evt_1", status: "SENT" },
		});
	});

	it.each([
		["list", async () => collection.GET(req("GET")), 120],
		["create", async () => collection.POST(req("POST", createBody())), 30],
		["read", async () => item.GET(req("GET"), idParams), 120],
		["patch", async () => item.PATCH(req("PATCH", { name: "x" }), idParams), 30],
		["delete", async () => item.DELETE(req("DELETE"), idParams), 30],
		["probe", async () => probe.POST(req("POST", {}), idParams), 30],
	])("%s requires ticket:manage at %s/min", async (_label, call, maxRequests) => {
		await call();
		expect(mocks.guardCalls[0]).toMatchObject({
			permission: "ticket:manage",
			rateLimit: { maxRequests, windowMs: 60_000 },
		});
	});

	it("lists connections for the caller's scope", async () => {
		const res = await collection.GET(req("GET"));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ connections: [connectionView] });
		expect(mocks.listItsmConnections).toHaveBeenCalledWith(session);
	});

	it("creates a connection, returns 201 and audits it", async () => {
		const res = await collection.POST(req("POST", createBody()));

		expect(res.status).toBe(201);
		expect(mocks.createItsmConnection).toHaveBeenCalledWith(
			expect.objectContaining({ name: "ops-slack", provider: "slack" }),
			session,
		);
		expect(mocks.auditUserAction).toHaveBeenCalledWith(
			"u_1",
			"itsm.connection.create",
			{ connectionId: "conn_1", provider: "slack", name: "ops-slack" },
			undefined,
			"team_1",
		);
	});

	it("does not echo the submitted credentials back, nor audit them", async () => {
		const res = await collection.POST(req("POST", createBody()));
		const text = await res.text();

		expect(text).not.toContain("s3cr3t-signing-key");
		expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain("s3cr3t-signing-key");
	});

	it("passes the session so the service can decide who may set teamId", async () => {
		await collection.POST(req("POST", createBody({ teamId: "team_other" })));
		// The route forwards it verbatim; `resolveConnectionTeamId` ignores it for
		// non-admins. What matters here is that the session travels with it.
		expect(mocks.createItsmConnection).toHaveBeenCalledWith(expect.anything(), session);
	});

	it.each([
		["a missing webhookUrl for an outbound-capable connection", { config: {} }],
		["an unknown provider", { provider: "carrier-pigeon" }],
		["a blank name", { name: "" }],
		["an unknown config key", { config: { webhookUrl: "https://a.test/h", retries: 3 } }],
	])("rejects %s", async (_label, overrides) => {
		const res = await collection.POST(req("POST", createBody(overrides)));
		expect(res.status).toBe(400);
		expect(mocks.createItsmConnection).not.toHaveBeenCalled();
	});

	it("keeps a 404 for a connection outside the caller's scope", async () => {
		const { NotFoundError } = await import("@/lib/errors");
		mocks.getItsmConnection.mockRejectedValue(new NotFoundError("not found"));
		const res = await item.GET(req("GET"), idParams);
		expect(res.status).toBe(404);
	});

	it("requires at least one field on PATCH and rejects unknown keys", async () => {
		expect((await item.PATCH(req("PATCH", {}), idParams)).status).toBe(400);
		expect((await item.PATCH(req("PATCH", { provider: "slack" }), idParams)).status).toBe(400);
		expect(mocks.updateItsmConnection).not.toHaveBeenCalled();
	});

	it("deletes and audits", async () => {
		const res = await item.DELETE(req("DELETE"), idParams);
		expect(res.status).toBe(200);
		expect(mocks.deleteItsmConnection).toHaveBeenCalledWith("conn_1", session);
		expect(mocks.auditUserAction).toHaveBeenCalledWith(
			"u_1",
			"itsm.connection.delete",
			{ connectionId: "conn_1" },
			undefined,
			"team_1",
		);
	});

	describe("connectivity probe", () => {
		it("returns 200 with the delivery event on success", async () => {
			const res = await probe.POST(req("POST", { message: "ping from tests" }), idParams);

			expect(res.status).toBe(200);
			expect(await res.json()).toMatchObject({ ok: true, event: { status: "SENT" } });
			expect(mocks.testItsmConnection).toHaveBeenCalledWith("conn_1", "ping from tests", session);
		});

		it("reports a failed delivery as 502, not a 200 with ok:false", async () => {
			mocks.testItsmConnection.mockResolvedValue({
				ok: false,
				event: { id: "evt_2", status: "FAILED" },
				error: "webhook host is not publicly routable",
			});

			const res = await probe.POST(req("POST", {}), idParams);
			const json = await res.json();

			expect(res.status).toBe(502);
			expect(json).toMatchObject({ ok: false, error: "webhook host is not publicly routable" });
			// The attempt is still audited, with its outcome.
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"itsm.connection.test",
				{ connectionId: "conn_1", ok: false },
				undefined,
				"team_1",
			);
		});

		it("works with no body at all", async () => {
			const res = await probe.POST(
				new Request("https://a.test/api/itsm/connections/conn_1/test", { method: "POST" }),
				idParams,
			);
			expect(res.status).toBe(200);
			expect(mocks.testItsmConnection).toHaveBeenCalledWith("conn_1", undefined, session);
		});

		it.each([
			["an over-long message", { message: "x".repeat(501) }],
			["an unknown field", { note: "hi" }],
		])("rejects %s", async (_label, body) => {
			const res = await probe.POST(req("POST", body), idParams);
			expect(res.status).toBe(400);
			expect(mocks.testItsmConnection).not.toHaveBeenCalled();
		});

		it("keeps a disabled-connection refusal as 400", async () => {
			const { ValidationError } = await import("@/lib/errors");
			mocks.testItsmConnection.mockRejectedValue(new ValidationError("connection is disabled"));
			const res = await probe.POST(req("POST", {}), idParams);
			expect(res.status).toBe(400);
			expect(mocks.auditUserAction).not.toHaveBeenCalled();
		});
	});
});
