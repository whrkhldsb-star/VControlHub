import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract tests for /api/docker/compose.
 *
 * Two scopes reach this route. With a `serverId` it acts on a tenant's own VPS
 * and `assertServerTeamAccess` decides; without one it acts on the hub host's
 * daemon — the platform's own containers — which needs platform-manager rights
 * (`docker:manage` alone ships in the default operator role). `down` there would
 * stop the platform itself, so both the read and the write path are guarded.
 */
const mocks = vi.hoisted(() => ({
	listComposeProjects: vi.fn(),
	runComposeProjectAction: vi.fn(),
	auditUserAction: vi.fn(),
	teamAccess: vi.fn(),
	guardCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/docker/compose-projects", () => ({
	listComposeProjects: mocks.listComposeProjects,
	runComposeProjectAction: mocks.runComposeProjectAction,
}));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));
vi.mock("@/lib/server/team-access", () => ({ assertServerTeamAccess: mocks.teamAccess }));
vi.mock("@/lib/i18n/service-translations", () => ({ t: (key: string) => key }));

let currentSession: Record<string, unknown> = {};

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
			return await handler({ session: currentSession, body });
		} catch (error) {
			// Mirror the real guard: an AppError keeps its own status.
			const status = (error as { status?: number }).status ?? options.errorStatus ?? 500;
			return Response.json({ error: (error as Error).message }, { status });
		}
	}),
}));

const platformManager = {
	userId: "u_1",
	username: "root",
	roles: ["admin"],
	mustChangePassword: false,
	currentTeamId: "team_1",
};

const tenantOperator = {
	userId: "u_2",
	username: "bob",
	roles: ["operator"],
	mustChangePassword: false,
	currentTeamId: "team_1",
};

const route = await import("../route");

function get(query = "") {
	return new Request(`https://a.test/api/docker/compose${query}`, { method: "GET" });
}

function post(body: unknown) {
	return new Request("https://a.test/api/docker/compose", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

const listResult = {
	projects: [{ name: "vcontrolhub", containers: 3, running: 3 }],
	scope: { scope: "hub-host", serverId: null, socketPath: "/var/run/docker.sock" },
	dockerAvailable: true,
	message: null,
};

const actionResult = {
	project: "app",
	action: "down",
	mode: "compose-cli",
	scope: { scope: "hub-host", serverId: null },
	stdout: "stopped",
	stderr: "",
};

describe("/api/docker/compose", () => {
	beforeEach(() => {
		for (const stub of [
			mocks.listComposeProjects,
			mocks.runComposeProjectAction,
			mocks.auditUserAction,
			mocks.teamAccess,
		]) {
			stub.mockReset();
		}
		mocks.guardCalls.length = 0;
		currentSession = platformManager;
		mocks.listComposeProjects.mockResolvedValue(listResult);
		mocks.runComposeProjectAction.mockResolvedValue(actionResult);
		mocks.teamAccess.mockResolvedValue({ ok: true, server: { id: "srv_1", teamId: "team_1" } });
	});

	describe("guard contract", () => {
		it("lists under docker:manage with a read limit", async () => {
			await route.GET(get());
			expect(mocks.guardCalls[0]).toMatchObject({
				permission: "docker:manage",
				rateLimit: { maxRequests: 120, windowMs: 60_000 },
			});
		});

		it("acts under docker:manage with the tighter command limit", async () => {
			await route.POST(post({ project: "app", action: "ps" }));
			expect(mocks.guardCalls[0]).toMatchObject({
				permission: "docker:manage",
				rateLimit: { maxRequests: 5, windowMs: 60_000 },
			});
		});
	});

	describe("hub-host scope", () => {
		it("403s a listing from a tenant-level operator", async () => {
			currentSession = tenantOperator;

			const res = await route.GET(get());

			expect(res.status).toBe(403);
			expect(mocks.listComposeProjects).not.toHaveBeenCalled();
		});

		it.each([["down"], ["up"], ["stop"], ["ps"]])(
			"403s the %s action from a tenant-level operator",
			async (action) => {
				currentSession = tenantOperator;

				const res = await route.POST(post({ project: "vcontrolhub", action }));

				expect(res.status).toBe(403);
				expect(mocks.runComposeProjectAction).not.toHaveBeenCalled();
				expect(mocks.auditUserAction).not.toHaveBeenCalled();
			},
		);

		it("treats an explicit null serverId as hub host, not as 'no check needed'", async () => {
			currentSession = tenantOperator;

			const res = await route.POST(post({ project: "app", action: "down", serverId: null }));

			expect(res.status).toBe(403);
			expect(mocks.teamAccess).not.toHaveBeenCalled();
			expect(mocks.runComposeProjectAction).not.toHaveBeenCalled();
		});

		it("rejects a whitespace-only serverId at the schema", async () => {
			currentSession = tenantOperator;

			const res = await route.POST(post({ project: "app", action: "down", serverId: "   " }));

			expect(res.status).toBe(400);
			expect(mocks.runComposeProjectAction).not.toHaveBeenCalled();
		});

		it("lets a platform manager list hub-host projects", async () => {
			const res = await route.GET(get());
			const json = await res.json();

			expect(res.status).toBe(200);
			expect(json).toEqual({
				projects: listResult.projects,
				dockerScope: listResult.scope,
				dockerAvailable: true,
				message: null,
			});
			expect(mocks.listComposeProjects).toHaveBeenCalledWith(undefined);
		});
	});

	describe("remote server scope", () => {
		it("404s a server outside the caller's team before touching Docker", async () => {
			currentSession = tenantOperator;
			mocks.teamAccess.mockResolvedValue({
				ok: false,
				response: Response.json({ error: "Server not found" }, { status: 404 }),
			});

			const res = await route.POST(post({ project: "app", action: "down", serverId: "srv_other" }));

			expect(res.status).toBe(404);
			expect(mocks.runComposeProjectAction).not.toHaveBeenCalled();
		});

		it("lets a tenant operator act on their own team's server", async () => {
			currentSession = tenantOperator;

			const res = await route.POST(post({ project: "app", action: "restart", serverId: "srv_1" }));

			expect(res.status).toBe(200);
			expect(mocks.teamAccess).toHaveBeenCalledWith(tenantOperator, "srv_1");
			expect(mocks.runComposeProjectAction).toHaveBeenCalledWith({
				project: "app",
				action: "restart",
				serverId: "srv_1",
				removeVolumes: false,
			});
		});

		it("scopes the listing to the checked server", async () => {
			currentSession = tenantOperator;
			await route.GET(get("?serverId=srv_1"));
			expect(mocks.teamAccess).toHaveBeenCalledWith(tenantOperator, "srv_1");
			expect(mocks.listComposeProjects).toHaveBeenCalledWith("srv_1");
		});
	});

	describe("actions", () => {
		it("audits a lifecycle action with the resolved scope", async () => {
			const res = await route.POST(post({ project: "app", action: "down", removeVolumes: true }));

			expect(res.status).toBe(200);
			expect(await res.json()).toMatchObject({ success: true, project: "app", mode: "compose-cli" });
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"docker.compose.down",
				{ project: "app", mode: "compose-cli", serverId: "hub-host", removeVolumes: true },
				undefined,
				"team_1",
			);
		});

		it("does not audit a read-only ps", async () => {
			await route.POST(post({ project: "app", action: "ps" }));
			expect(mocks.auditUserAction).not.toHaveBeenCalled();
		});

		it("passes removeVolumes only when explicitly true", async () => {
			await route.POST(post({ project: "app", action: "down", removeVolumes: "yes" as never }));
			expect(mocks.runComposeProjectAction).not.toHaveBeenCalled();
		});

		it.each([
			["an unknown action", { project: "app", action: "nuke" }],
			["a blank project", { project: "", action: "ps" }],
			["an over-long project name", { project: "p".repeat(129), action: "ps" }],
		])("rejects %s at the schema", async (_label, body) => {
			const res = await route.POST(post(body));
			expect(res.status).toBe(400);
			expect(mocks.runComposeProjectAction).not.toHaveBeenCalled();
		});

		it("keeps a docker-unavailable refusal as 422", async () => {
			const { BusinessError } = await import("@/lib/errors");
			mocks.runComposeProjectAction.mockRejectedValue(new BusinessError("docker unavailable"));

			const res = await route.POST(post({ project: "app", action: "up" }));

			expect(res.status).toBe(422);
			expect(mocks.auditUserAction).not.toHaveBeenCalled();
		});
	});
});
