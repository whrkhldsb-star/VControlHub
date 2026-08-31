import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotFoundError } from "@/lib/errors";

/**
 * Contract tests for `/api/alert-incidents`.
 *
 * Both methods sit behind `notification:manage`. The tenant boundary lives in
 * `@/lib/alert/incidents` (see `src/lib/alert/__tests__/incidents.test.ts`),
 * which cross-checks the incident's rule *and* its server against `teamWhere`
 * and throws NotFoundError — deliberately not ForbiddenError — for anything
 * outside the caller's team, so an ack attempt cannot be used to probe which
 * incident ids exist. This file pins what the route itself owns:
 *
 * 1. The session reaches both service calls. `listAlertIncidents({})` with no
 *    session applies **no** team filter, so dropping that argument would list
 *    every tenant's incidents — the projection below would happily serialise
 *    other teams' server names and alert messages.
 * 2. The GET projection is a fixed allow-list, not a spread of the Prisma row.
 *    Incidents carry a `rule` relation and an `acknowledgedBy` user; only three
 *    fields of that user (id/username/displayName) may cross the wire.
 * 3. `status` is validated by `parseSearchParams` *inside* the handler rather
 *    than by the guard's `querySchema`, so its rejection has to arrive as a 400
 *    through `apiCatch` — a plain `Error` there would become a 500.
 */
const mocks = vi.hoisted(() => ({
	listAlertIncidents: vi.fn(),
	acknowledgeAlertIncident: vi.fn(),
	auditUserAction: vi.fn(),
	guardCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/alert/incidents", () => ({
	listAlertIncidents: mocks.listAlertIncidents,
	acknowledgeAlertIncident: mocks.acknowledgeAlertIncident,
}));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

vi.mock("@/lib/http/api-guard", () => ({
	withApiRoute: vi.fn(async (request: Request, options: any, handler: any) => {
		mocks.guardCalls.push(options);
		let body: unknown = undefined;
		if (options.bodySchema) {
			const raw = await request.clone().json().catch(() => undefined);
			const parsed = options.bodySchema.safeParse(raw);
			if (!parsed.success) return Response.json({ error: "VALIDATION_FAILED" }, { status: 400 });
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

const route = await import("../route");

/** A full incident row, including the relations the projection must narrow. */
function incidentRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "inc_1",
		fingerprint: "fp-1",
		ruleId: "rule_1",
		serverId: "srv_1",
		serverName: "web-01",
		metric: "cpu",
		operator: "gt",
		threshold: 90,
		value: 97.5,
		status: "OPEN",
		level: "warning",
		title: "CPU high",
		message: "cpu 97.5% > 90%",
		acknowledgedAt: null as Date | null,
		acknowledgedBy: null as null | { id: string; username: string; displayName: string | null },
		escalatedAt: null as Date | null,
		lastNotifiedAt: null as Date | null,
		resolvedAt: null as Date | null,
		createdAt: new Date("2026-08-31T10:00:00.000Z"),
		rule: { id: "rule_1", name: "cpu guard", escalationMinutes: 15, onCallUserIds: ["u_2"] },
		...overrides,
	};
}

function req(method: string, body?: unknown, url = "https://a.test/api/alert-incidents") {
	return new Request(url, {
		method,
		headers: { "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

describe("/api/alert-incidents", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.guardCalls.length = 0;
		mocks.listAlertIncidents.mockReset();
		mocks.acknowledgeAlertIncident.mockReset();
		mocks.listAlertIncidents.mockResolvedValue([incidentRow()]);
		mocks.acknowledgeAlertIncident.mockResolvedValue({ id: "inc_1", status: "ACKNOWLEDGED" });
	});

	describe("guard options", () => {
		it("gates both methods on notification:manage", async () => {
			await route.GET(req("GET"));
			await route.POST(req("POST", { incidentId: "inc_1" }));
			expect(mocks.guardCalls.map((o) => o.permission)).toEqual([
				"notification:manage",
				"notification:manage",
			]);
		});

		it("rate-limits both methods", async () => {
			await route.GET(req("GET"));
			await route.POST(req("POST", { incidentId: "inc_1" }));
			expect(mocks.guardCalls.every((o) => Boolean(o.rateLimit))).toBe(true);
		});
	});

	describe("GET", () => {
		it("passes the session so incidents stay team-scoped", async () => {
			const res = await route.GET(req("GET"));
			expect(res.status).toBe(200);
			expect(mocks.listAlertIncidents).toHaveBeenCalledWith({ status: undefined, session });
		});

		it("forwards a status filter", async () => {
			await route.GET(req("GET", undefined, "https://a.test/api/alert-incidents?status=RESOLVED"));
			expect(mocks.listAlertIncidents).toHaveBeenCalledWith({ status: "RESOLVED", session });
		});

		it("rejects an unknown status as 400, not 500", async () => {
			const res = await route.GET(req("GET", undefined, "https://a.test/api/alert-incidents?status=BROKEN"));
			expect(res.status).toBe(400);
			expect(mocks.listAlertIncidents).not.toHaveBeenCalled();
		});

		it("projects a fixed field set and serialises the dates as ISO strings", async () => {
			const res = await route.GET(req("GET"));
			const payload = (await res.json()) as { incidents: Array<Record<string, unknown>> };
			expect(payload.incidents).toHaveLength(1);
			expect(payload.incidents[0]).toEqual({
				id: "inc_1",
				fingerprint: "fp-1",
				ruleId: "rule_1",
				ruleName: "cpu guard",
				serverId: "srv_1",
				serverName: "web-01",
				metric: "cpu",
				operator: "gt",
				threshold: 90,
				value: 97.5,
				status: "OPEN",
				level: "warning",
				title: "CPU high",
				message: "cpu 97.5% > 90%",
				acknowledgedAt: null,
				acknowledgedBy: null,
				escalatedAt: null,
				lastNotifiedAt: null,
				resolvedAt: null,
				createdAt: "2026-08-31T10:00:00.000Z",
				escalationMinutes: 15,
				onCallUserIds: ["u_2"],
			});
		});

		it("drops the raw rule relation instead of spreading it into the response", async () => {
			// The row carries a whole `rule` object; only its name, escalation
			// window and on-call list are part of this endpoint's contract.
			const res = await route.GET(req("GET"));
			const payload = (await res.json()) as { incidents: Array<Record<string, unknown>> };
			expect(payload.incidents[0]).not.toHaveProperty("rule");
		});

		it("narrows the acknowledging user to id/username/displayName", async () => {
			mocks.listAlertIncidents.mockResolvedValue([
				incidentRow({
					acknowledgedAt: new Date("2026-08-31T11:00:00.000Z"),
					acknowledgedBy: {
						id: "u_2",
						username: "sre",
						displayName: "SRE",
						// Fields a naive spread would leak:
						passwordHash: "$2b$10$hash",
						email: "sre@example.test",
						totpSecret: "JBSWY3DP",
					},
				}),
			]);
			const res = await route.GET(req("GET"));
			const payload = (await res.json()) as {
				incidents: Array<{ acknowledgedAt: string; acknowledgedBy: Record<string, unknown> }>;
			};
			expect(payload.incidents[0]!.acknowledgedAt).toBe("2026-08-31T11:00:00.000Z");
			expect(payload.incidents[0]!.acknowledgedBy).toEqual({
				id: "u_2",
				username: "sre",
				displayName: "SRE",
			});
		});

		it("defaults escalationMinutes to 30 and onCallUserIds to [] for a fleet incident with no rule", async () => {
			mocks.listAlertIncidents.mockResolvedValue([incidentRow({ rule: null, serverId: null, serverName: null })]);
			const res = await route.GET(req("GET"));
			const payload = (await res.json()) as {
				incidents: Array<{ ruleName: null; escalationMinutes: number; onCallUserIds: string[] }>;
			};
			expect(payload.incidents[0]!.ruleName).toBeNull();
			expect(payload.incidents[0]!.escalationMinutes).toBe(30);
			expect(payload.incidents[0]!.onCallUserIds).toEqual([]);
		});

		it("returns an empty list rather than 404 when nothing is open", async () => {
			mocks.listAlertIncidents.mockResolvedValue([]);
			const res = await route.GET(req("GET"));
			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toEqual({ incidents: [] });
		});
	});

	describe("POST — acknowledge", () => {
		it("acks by body id, passes the session, and audits the resulting status", async () => {
			const res = await route.POST(req("POST", { incidentId: "inc_1" }));
			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toEqual({
				success: true,
				incident: { id: "inc_1", status: "ACKNOWLEDGED" },
			});
			expect(mocks.acknowledgeAlertIncident).toHaveBeenCalledWith({
				incidentId: "inc_1",
				userId: "u_1",
				session,
			});
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"alert_incident.acknowledge",
				{ incidentId: "inc_1", status: "ACKNOWLEDGED" },
				undefined,
				"team_1",
			);
		});

		it("rejects a missing incidentId", async () => {
			const res = await route.POST(req("POST", {}));
			expect(res.status).toBe(400);
			expect(mocks.acknowledgeAlertIncident).not.toHaveBeenCalled();
		});

		it("rejects a blank incidentId", async () => {
			const res = await route.POST(req("POST", { incidentId: "   " }));
			expect(res.status).toBe(400);
			expect(mocks.acknowledgeAlertIncident).not.toHaveBeenCalled();
		});

		it("maps another team's incident to 404 and writes no audit entry", async () => {
			// The service answers NotFoundError rather than Forbidden so the ack
			// endpoint cannot be used to enumerate other tenants' incident ids.
			mocks.acknowledgeAlertIncident.mockRejectedValue(new NotFoundError("alert incident not found"));
			const res = await route.POST(req("POST", { incidentId: "inc_other_team" }));
			expect(res.status).toBe(404);
			expect(mocks.auditUserAction).not.toHaveBeenCalled();
		});

		it("records the acked id the service returned, not the one that was requested", async () => {
			mocks.acknowledgeAlertIncident.mockResolvedValue({ id: "inc_canonical", status: "RESOLVED" });
			await route.POST(req("POST", { incidentId: "inc_1" }));
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"alert_incident.acknowledge",
				{ incidentId: "inc_canonical", status: "RESOLVED" },
				undefined,
				"team_1",
			);
		});
	});
});
