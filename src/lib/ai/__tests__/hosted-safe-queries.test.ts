import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for `executeServerlessQuery` — the AI assistant's read-only tool surface
 * (search_knowledge / list_servers / list_backups / query_traffic /
 * list_scheduled_tasks / list_command_templates / manage_cron).
 *
 * These are the queries an LLM can invoke on the user's behalf, so the property
 * that matters is that the caller's team scope reaches every one of them. Two
 * traps live in this file specifically:
 *
 * 1. A **null scope must not degrade to "no filter"**. The module handles this by
 *    substituting `{ teamId: null }` for the server queries — quarantined legacy
 *    rows rather than everything — and the header on `search_knowledge` spells
 *    out the matching rule for sessions: pass the session through, never force
 *    `currentTeamId: null`.
 * 2. `list_servers` selects `host`/`username`, which is exactly the material a
 *    cross-tenant leak here would hand to the model (and thus to the user's chat
 *    transcript), so its filter gets its own cases.
 *
 * `team-scope` is kept real so the emitted filters are the production ones, and
 * the last case pins that an unknown actionType returns `null` — that is the
 * signal `hosted-service` uses to fall through to the SSH execution path, so
 * returning an error object instead would silently disable every SSH action.
 */
const mocks = vi.hoisted(() => ({
	serverFindMany: vi.fn(),
	backupFindMany: vi.fn(),
	trafficFindMany: vi.fn(),
	searchKnowledge: vi.fn(),
	listScheduledTasks: vi.fn(),
	getScheduledTask: vi.fn(),
	toggleScheduledTask: vi.fn(),
	listTemplates: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
	prisma: {
		server: { findMany: mocks.serverFindMany },
		backupRecord: { findMany: mocks.backupFindMany },
		trafficSnapshot: { findMany: mocks.trafficFindMany },
	},
}));
vi.mock("../knowledge", () => ({ searchKnowledge: mocks.searchKnowledge }));
vi.mock("@/lib/scheduled-task/service", () => ({
	listScheduledTasks: mocks.listScheduledTasks,
	getScheduledTask: mocks.getScheduledTask,
	toggleScheduledTask: mocks.toggleScheduledTask,
}));
vi.mock("@/lib/command-template/service", () => ({ listTemplates: mocks.listTemplates }));

import { executeServerlessQuery } from "../hosted-safe-queries";

type Scope = { userId: string; roles: never; currentTeamId: string | null };

const operator: Scope = { userId: "u_1", roles: ["operator"] as never, currentTeamId: "team_1" };
const admin: Scope = { userId: "admin", roles: ["admin"] as never, currentTeamId: null };

function call(actionType: string, params: Record<string, unknown> = {}, scope: Scope | null = operator) {
	return executeServerlessQuery({ actionType, params }, scope);
}

describe("executeServerlessQuery", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		for (const m of Object.values(mocks)) m.mockReset();
		mocks.serverFindMany.mockResolvedValue([]);
		mocks.backupFindMany.mockResolvedValue([]);
		mocks.trafficFindMany.mockResolvedValue([]);
		mocks.searchKnowledge.mockResolvedValue([]);
		mocks.listScheduledTasks.mockResolvedValue([]);
		mocks.listTemplates.mockResolvedValue([]);
	});

	it("returns null for an unknown actionType so the SSH path still runs", async () => {
		await expect(call("restart_service")).resolves.toBeNull();
	});

	describe("list_servers", () => {
		it("scopes to the caller's team", async () => {
			await call("list_servers");
			expect(mocks.serverFindMany).toHaveBeenCalledWith(
				expect.objectContaining({ where: { teamId: "team_1" } }),
			);
		});

		it("quarantines legacy rows instead of listing everything for a null scope", async () => {
			// The dangerous alternative is `where: {}` — every tenant's host and
			// SSH username handed straight to the model.
			await call("list_servers", {}, null);
			expect(mocks.serverFindMany).toHaveBeenCalledWith(
				expect.objectContaining({ where: { teamId: null } }),
			);
		});

		it("lets a platform manager see the whole fleet", async () => {
			await call("list_servers", {}, admin);
			expect(mocks.serverFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
		});

		it("never selects credentials, only connection metadata", async () => {
			await call("list_servers");
			const select = mocks.serverFindMany.mock.calls[0]![0].select as Record<string, boolean>;
			expect(Object.keys(select).sort()).toEqual(["enabled", "host", "id", "name", "port", "username"]);
		});

		it("bounds the result set", async () => {
			await call("list_servers");
			expect(mocks.serverFindMany.mock.calls[0]![0].take).toBe(500);
		});
	});

	describe("list_backups", () => {
		it("applies the loose team filter, which admits legacy null-team records", async () => {
			// Backups use `teamWhere`, not the strict `serverTeamWhere`: a
			// `teamId: null` backup row predates multi-tenancy and is treated as
			// shared. Pinned explicitly so the difference from `list_servers`
			// above is a recorded decision rather than an inconsistency.
			await call("list_backups");
			expect(mocks.backupFindMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({ OR: [{ teamId: "team_1" }, { teamId: null }] }),
				}),
			);
		});

		it("applies no backup filter at all for a null scope", async () => {
			// Documented, not endorsed: `list_backups` reaches for `teamWhere` only
			// when a scope exists, so a sessionless caller sees every team's backup
			// notes. The only sessionless caller today is an internal one — a
			// request path must always pass its session.
			await call("list_backups", {}, null);
			const where = mocks.backupFindMany.mock.calls[0]![0].where as Record<string, unknown>;
			expect(where).toEqual({});
		});

		it("uppercases the type and status filters the model supplies", async () => {
			await call("list_backups", { type: " database ", status: "failed" });
			expect(mocks.backupFindMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({ type: "DATABASE", status: "FAILED" }),
				}),
			);
		});

		it("omits a blank filter rather than matching an empty string", async () => {
			await call("list_backups", { type: "   " });
			const where = mocks.backupFindMany.mock.calls[0]![0].where as Record<string, unknown>;
			expect(where).not.toHaveProperty("type");
		});

		it("serialises dates and preserves a null fileSize", async () => {
			mocks.backupFindMany.mockResolvedValue([
				{
					id: "b1",
					type: "DATABASE",
					status: "COMPLETED",
					note: null,
					fileSize: null,
					createdAt: new Date("2026-08-31T00:00:00.000Z"),
					completedAt: null,
					errorMessage: null,
				},
			]);
			const res = await call("list_backups");
			expect(res).toMatchObject({
				success: true,
				data: {
					count: 1,
					backups: [expect.objectContaining({ createdAt: "2026-08-31T00:00:00.000Z", completedAt: null, fileSize: null })],
				},
			});
		});
	});

	describe("search_knowledge", () => {
		it("forwards the session so the knowledge query stays team-filtered", async () => {
			// `searchKnowledge` treats a missing session as "no team filter", so
			// dropping this argument would search every tenant's documents.
			await call("search_knowledge", { query: "nginx" });
			expect(mocks.searchKnowledge).toHaveBeenCalledWith(
				expect.objectContaining({ query: "nginx", session: operator }),
			);
		});

		it("passes undefined rather than a forged empty session when there is no scope", async () => {
			await call("search_knowledge", { query: "nginx" }, null);
			expect(mocks.searchKnowledge).toHaveBeenCalledWith(
				expect.objectContaining({ session: undefined }),
			);
		});

		it("coerces a string limit and falls back to 5 for a non-numeric one", async () => {
			await call("search_knowledge", { query: "q", limit: "12" });
			expect(mocks.searchKnowledge.mock.calls[0]![0].limit).toBe(12);
			await call("search_knowledge", { query: "q", limit: "abc" });
			expect(mocks.searchKnowledge.mock.calls[1]![0].limit).toBe(5);
		});

		it("truncates each excerpt so one document cannot flood the model context", async () => {
			mocks.searchKnowledge.mockResolvedValue([
				{ knowledgeBaseName: "kb", documentTitle: "d", chunkIndex: 0, score: 1, content: "x".repeat(5000) },
			]);
			const res = (await call("search_knowledge", { query: "q" })) as { data: { hits: Array<{ excerpt: string }> } };
			expect(res.data.hits[0]!.excerpt).toHaveLength(1200);
		});
	});

	describe("query_traffic", () => {
		it("restricts snapshots to servers visible under the strict server filter", async () => {
			mocks.serverFindMany.mockResolvedValue([{ id: "srv_1" }, { id: "srv_2" }]);
			await call("query_traffic");
			expect(mocks.serverFindMany).toHaveBeenCalledWith(
				expect.objectContaining({ where: { teamId: "team_1" } }),
			);
			const where = mocks.trafficFindMany.mock.calls[0]![0].where as { OR: unknown[] };
			expect(where.OR).toEqual([{ serverId: null }, { serverId: { in: ["srv_1", "srv_2"] } }]);
		});

		it("keeps only the fleet-wide rows when the caller has no visible servers", async () => {
			// The `in: []` branch is omitted deliberately — Prisma would match
			// nothing, but building `{ in: [] }` alongside `serverId: null` is the
			// kind of thing a later edit turns into an unfiltered OR.
			mocks.serverFindMany.mockResolvedValue([]);
			await call("query_traffic");
			const where = mocks.trafficFindMany.mock.calls[0]![0].where as { OR: unknown[] };
			expect(where.OR).toEqual([{ serverId: null }]);
		});

		it("averages the samples and reports the latest one", async () => {
			mocks.serverFindMany.mockResolvedValue([{ id: "srv_1" }]);
			mocks.trafficFindMany.mockResolvedValue([
				{ source: "agent", serverId: "srv_1", iface: "eth0", rxRateBps: 300, txRateBps: 100, sampledAt: new Date("2026-08-31T12:00:00.000Z") },
				{ source: "agent", serverId: "srv_1", iface: "eth0", rxRateBps: 100, txRateBps: 300, sampledAt: new Date("2026-08-31T11:00:00.000Z") },
			]);
			const res = (await call("query_traffic")) as { data: { averageRxBps: number; averageTxBps: number; sampleCount: number; latest: { sampledAt: string } } };
			expect(res.data.sampleCount).toBe(2);
			expect(res.data.averageRxBps).toBe(200);
			expect(res.data.averageTxBps).toBe(200);
			expect(res.data.latest.sampledAt).toBe("2026-08-31T12:00:00.000Z");
		});

		it("treats a null rate as zero rather than NaN-ing the average", async () => {
			mocks.serverFindMany.mockResolvedValue([{ id: "srv_1" }]);
			mocks.trafficFindMany.mockResolvedValue([
				{ source: "agent", serverId: null, iface: null, rxRateBps: null, txRateBps: null, sampledAt: new Date("2026-08-31T12:00:00.000Z") },
			]);
			const res = (await call("query_traffic")) as { data: { averageRxBps: number } };
			expect(res.data.averageRxBps).toBe(0);
		});

		it.each([
			["7d", "7d"],
			["week", "7d"],
			["30days", "30d"],
			["month", "30d"],
			["today", "today"],
			["nonsense", "today"],
			[undefined, "today"],
		])("normalises period %s to %s", async (input, expected) => {
			mocks.serverFindMany.mockResolvedValue([]);
			const params = input === undefined ? {} : { period: input };
			const res = (await call("query_traffic", params)) as { data: { period: string } };
			expect(res.data.period).toBe(expected);
		});

		it("returns a note instead of a bare zero when no samples exist", async () => {
			mocks.serverFindMany.mockResolvedValue([]);
			const res = (await call("query_traffic")) as { data: { note?: string } };
			expect(res.data.note).toBeTruthy();
		});
	});

	describe("list_scheduled_tasks and list_command_templates", () => {
		it("passes the scope to the scheduled-task service", async () => {
			await call("list_scheduled_tasks");
			expect(mocks.listScheduledTasks).toHaveBeenCalledWith(50, operator);
		});

		it("passes null rather than undefined when there is no scope", async () => {
			await call("list_scheduled_tasks", {}, null);
			expect(mocks.listScheduledTasks).toHaveBeenCalledWith(50, null);
		});

		it("truncates a long lastResult", async () => {
			mocks.listScheduledTasks.mockResolvedValue([
				{ id: "t1", name: "n", cronExpression: "* * * * *", status: "ACTIVE", nextRunAt: null, lastRunAt: null, lastResult: "e".repeat(500) },
			]);
			const res = (await call("list_scheduled_tasks")) as { data: { tasks: Array<{ lastResult: string }> } };
			expect(res.data.tasks[0]!.lastResult).toHaveLength(200);
		});

		it("passes the scope to the template service and filters by query client-side", async () => {
			mocks.listTemplates.mockResolvedValue([
				{ id: "c1", name: "restart nginx", description: null, command: "systemctl restart nginx", rollbackCommand: null, variables: [], tags: ["web"], isBuiltin: true },
				{ id: "c2", name: "disk usage", description: null, command: "df -h", rollbackCommand: null, variables: [], tags: [], isBuiltin: true },
			]);
			await call("list_command_templates");
			expect(mocks.listTemplates).toHaveBeenCalledWith(100, operator);
			const res = (await call("list_command_templates", { query: "NGINX" })) as { data: { count: number } };
			expect(res.data.count).toBe(1);
		});

		it("matches the query against tags as well as the name", async () => {
			mocks.listTemplates.mockResolvedValue([
				{ id: "c1", name: "restart", description: null, command: "x", rollbackCommand: null, variables: [], tags: ["web"], isBuiltin: true },
			]);
			const res = (await call("list_command_templates", { query: "web" })) as { data: { count: number } };
			expect(res.data.count).toBe(1);
		});
	});

	describe("manage_cron", () => {
		it("resolves the task through the team-scoped getter before toggling", async () => {
			mocks.getScheduledTask.mockResolvedValue({ id: "t1", status: "ACTIVE" });
			mocks.toggleScheduledTask.mockResolvedValue({ id: "t1", status: "PAUSED" });
			const res = await call("manage_cron", { action: "pause", taskId: "t1" });
			expect(mocks.getScheduledTask).toHaveBeenCalledWith("t1", operator);
			expect(mocks.toggleScheduledTask).toHaveBeenCalledWith("t1", operator);
			expect(res).toMatchObject({ success: true, data: { status: "PAUSED" } });
		});

		it("reports a not-found/foreign task as a failure instead of throwing", async () => {
			// A cross-team id reaches `getScheduledTask`, which throws; surfacing
			// that as `success: false` keeps the assistant from crashing the turn.
			mocks.getScheduledTask.mockRejectedValue(new Error("Scheduled task not found"));
			const res = await call("manage_cron", { action: "pause", taskId: "t_other_team" });
			expect(res).toMatchObject({ success: false, error: "Scheduled task not found" });
			expect(mocks.toggleScheduledTask).not.toHaveBeenCalled();
		});

		it("is idempotent when the task is already in the requested state", async () => {
			mocks.getScheduledTask.mockResolvedValue({ id: "t1", status: "PAUSED" });
			const res = await call("manage_cron", { action: "pause", taskId: "t1" });
			expect(res).toMatchObject({ success: true });
			expect(mocks.toggleScheduledTask).not.toHaveBeenCalled();
		});

		it("refuses to toggle a task in any other state", async () => {
			// Only ACTIVE↔PAUSED is a legal transition; COMPLETED/FAILED tasks must
			// not be flipped back into a schedule by a chat message.
			mocks.getScheduledTask.mockResolvedValue({ id: "t1", status: "COMPLETED" });
			const res = await call("manage_cron", { action: "pause", taskId: "t1" });
			expect(res).toMatchObject({ success: false });
			expect(mocks.toggleScheduledTask).not.toHaveBeenCalled();
		});

		it("requires a taskId", async () => {
			const res = await call("manage_cron", { action: "resume" });
			expect(res).toMatchObject({ success: false });
			expect(mocks.getScheduledTask).not.toHaveBeenCalled();
		});

		it("rejects any action other than pause/resume", async () => {
			// Notably `delete` and `create`: this tool is read-mostly, and a
			// destructive verb must not fall through to a toggle.
			for (const action of ["delete", "create", "run", ""]) {
				const res = await call("manage_cron", { action, taskId: "t1" });
				expect(res).toMatchObject({ success: false });
			}
			expect(mocks.toggleScheduledTask).not.toHaveBeenCalled();
		});

		it("resumes a paused task", async () => {
			mocks.getScheduledTask.mockResolvedValue({ id: "t1", status: "PAUSED" });
			mocks.toggleScheduledTask.mockResolvedValue({ id: "t1", status: "ACTIVE" });
			const res = await call("manage_cron", { action: "RESUME", taskId: " t1 " });
			expect(res).toMatchObject({ success: true, data: { status: "ACTIVE" } });
		});
	});
});
