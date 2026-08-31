import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/system/export
 *
 * This route hands out a whole workspace's configuration as a file, so the
 * tenant boundary is the query string: `mode=full` (secrets) and `scope=global`
 * (every team) are both platform-admin-only, enforced inside
 * `buildExportFile`. The route's job is to pass the caller's own
 * `currentTeamId` — never a client-supplied team — and to keep the service's
 * 403/400 refusals as 403/400 rather than a 500. Unknown values for either
 * parameter must fall back to the *narrow* option, not the broad one.
 */
const mocks = vi.hoisted(() => ({
	buildExportFile: vi.fn(),
	getExportSummary: vi.fn(),
	auditUserAction: vi.fn(),
	guardCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/system/export-service", () => ({
	buildExportFile: mocks.buildExportFile,
	getExportSummary: mocks.getExportSummary,
}));

vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

vi.mock("@/lib/http/api-guard", () => ({
	withApiRoute: vi.fn(async (_request: Request, options: any, handler: any) => {
		mocks.guardCalls.push(options);
		try {
			return await handler({ session });
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

const exportFile = {
	formatVersion: 1,
	exportMode: "standard",
	exportScope: "team",
	exportTeamId: "team_1",
	servers: [],
};

function get(query = "") {
	return new Request(`https://vch.example.com/api/system/export${query}`, { method: "GET" });
}

describe("GET /api/system/export", () => {
	beforeEach(() => {
		mocks.buildExportFile.mockReset();
		mocks.getExportSummary.mockReset();
		mocks.auditUserAction.mockReset();
		mocks.guardCalls.length = 0;
		mocks.buildExportFile.mockResolvedValue(exportFile);
		mocks.getExportSummary.mockReturnValue({ servers: 0 });
	});

	it("requires user:manage behind a write rate limit", async () => {
		await route.GET(get());
		expect(mocks.guardCalls[0]).toMatchObject({
			permission: "user:manage",
			rateLimit: { maxRequests: 30, windowMs: 60_000 },
		});
	});

	it("defaults to the narrow standard/team export", async () => {
		await route.GET(get());
		expect(mocks.buildExportFile).toHaveBeenCalledWith({
			sourceDomain: "vch.example.com",
			mode: "standard",
			scope: "team",
			teamId: "team_1",
			session,
		});
	});

	it.each([
		["mode", "?mode=FULL", { mode: "standard" }],
		["mode", "?mode=everything", { mode: "standard" }],
		["scope", "?scope=GLOBAL", { scope: "team" }],
		["scope", "?scope=all", { scope: "team" }],
		["scope", "?scope=", { scope: "team" }],
	])("falls back to the narrow %s for an unrecognised value", async (_k, query, expected) => {
		await route.GET(get(query));
		expect(mocks.buildExportFile).toHaveBeenCalledWith(expect.objectContaining(expected));
	});

	it("forwards the exact opt-in values so the service can enforce them", async () => {
		await route.GET(get("?mode=full&scope=global"));
		expect(mocks.buildExportFile).toHaveBeenCalledWith(
			expect.objectContaining({ mode: "full", scope: "global" }),
		);
	});

	it("scopes the export to the caller's own team, ignoring a teamId in the query", async () => {
		await route.GET(get("?teamId=team_victim"));
		expect(mocks.buildExportFile).toHaveBeenCalledWith(
			expect.objectContaining({ teamId: "team_1" }),
		);
	});

	it("returns the file as a pretty-printed JSON attachment", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-31T12:34:56.000Z"));
		let res: Response;
		try {
			res = await route.GET(get());
		} finally {
			vi.useRealTimers();
		}

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
		expect(res.headers.get("Content-Disposition")).toBe(
			'attachment; filename="vch-config-team-2026-08-31-12-34-56.json"',
		);
		const text = await res.text();
		expect(text).toContain('\n  "formatVersion": 1');
		expect(JSON.parse(text)).toMatchObject({ exportScope: "team" });
	});

	it("names the file after the scope the service actually applied", async () => {
		// The service may downgrade or confirm the scope; the filename must follow
		// the file, not the request, or a team export could be labelled global.
		mocks.buildExportFile.mockResolvedValue({ ...exportFile, exportScope: "global", exportTeamId: null });
		const res = await route.GET(get("?scope=global"));
		expect(res.headers.get("Content-Disposition")).toContain("vch-config-global-");
	});

	it("audits the export with the applied mode/scope and the record counts", async () => {
		mocks.getExportSummary.mockReturnValue({ servers: 3, storageNodes: 1 });
		await route.GET(get("?mode=full"));
		expect(mocks.auditUserAction).toHaveBeenCalledWith(
			"u_1",
			"system.export",
			{
				sourceDomain: "vch.example.com",
				exportMode: "standard",
				exportScope: "team",
				exportTeamId: "team_1",
				recordCounts: { servers: 3, storageNodes: 1 },
			},
			undefined,
			"team_1",
		);
	});

	it("keeps a platform-admin refusal as 403 and writes no audit entry", async () => {
		const { ForbiddenError } = await import("@/lib/errors");
		mocks.buildExportFile.mockRejectedValue(
			new ForbiddenError("full export with secrets requires platform admin"),
		);

		const res = await route.GET(get("?mode=full"));
		const json = await res.json();

		expect(res.status).toBe(403);
		expect(json.error).toBe("full export with secrets requires platform admin");
		expect(mocks.auditUserAction).not.toHaveBeenCalled();
	});

	it("keeps a validation refusal as 400", async () => {
		const { ValidationError } = await import("@/lib/errors");
		mocks.buildExportFile.mockRejectedValue(new ValidationError("no team selected"));
		const res = await route.GET(get());
		expect(res.status).toBe(400);
	});

	it("lets an unexpected failure reach the guard as a 500", async () => {
		mocks.buildExportFile.mockRejectedValue(new Error("db down"));
		const res = await route.GET(get());
		expect(res.status).toBe(500);
		expect(mocks.auditUserAction).not.toHaveBeenCalled();
	});
});
