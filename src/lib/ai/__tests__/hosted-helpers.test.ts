import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the AI hosted-action helpers.
 *
 * Two of these decide what the assistant is allowed to touch:
 *
 *   - `requiredPermissionForAction` maps a tool name to the permission checked
 *     before it runs. Its **default is `server:ssh`** — the most privileged
 *     answer — so an unrecognised or newly added tool fails closed rather than
 *     inheriting a read permission. That default is the important assertion, and
 *     it must never be relaxed to something like `ai:chat`.
 *   - `resolveServerId` / `resolvePlaybookId` turn free-text model output
 *     ("restart the web box") into an id. They must filter by team *inside* the
 *     query, because the fuzzy `contains` match is driven by attacker-influenced
 *     chat text: an unfiltered lookup would let a prompt name another tenant's
 *     host and receive a usable id back.
 *
 * `team-scope` stays real so the filters are production shapes. Note the two
 * resolvers deliberately differ on the sessionless fallback — servers fall back
 * to `{ teamId: null }` (quarantined legacy rows) while playbooks fall back to
 * `{}` — and both branches are pinned so the asymmetry is a recorded decision.
 */
const mocks = vi.hoisted(() => ({
	serverFindFirst: vi.fn(),
	playbookFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
	prisma: {
		server: { findFirst: mocks.serverFindFirst },
		playbook: { findFirst: mocks.playbookFindFirst },
	},
}));

import {
	SERVERLESS_ACTION_TYPES,
	isHostedActionType,
	permissionDeniedMessage,
	requiredPermissionForAction,
	resolvePlaybookId,
	resolveServerId,
	sessionForTeamScope,
} from "../hosted-helpers";

const operator = { userId: "u_1", roles: ["operator"] as never, currentTeamId: "team_1" };
const admin = { userId: "admin", roles: ["admin"] as never, currentTeamId: null };

describe("requiredPermissionForAction", () => {
	it.each([
		["list_servers", "server:read"],
		["list_backups", "backup:read"],
		["run_playbook", "playbook:run"],
		["query_traffic", "health:read"],
		["list_scheduled_tasks", "command:read"],
		["list_command_templates", "command:read"],
		["create_automation_task", "command:create"],
		["manage_cron", "command:create"],
		["search_knowledge", "ai:chat"],
		["list_files", "storage:read"],
		["search_files", "storage:read"],
		["read_file", "storage:read"],
	])("maps %s to %s", (action, permission) => {
		expect(requiredPermissionForAction(action)).toBe(permission);
	});

	it.each(["execute_command", "restart_service", "modify_config", "deploy_docker", "read_logs", "get_status"])(
		"requires server:ssh for the executing action %s",
		(action) => {
			expect(requiredPermissionForAction(action)).toBe("server:ssh");
		},
	);

	it("fails closed on an unknown action rather than granting a read permission", () => {
		// A tool added to the catalogue but forgotten here inherits the most
		// privileged answer, so the omission shows up as a denial in testing
		// instead of as an unguarded capability in production.
		expect(requiredPermissionForAction("some_new_tool")).toBe("server:ssh");
		expect(requiredPermissionForAction("")).toBe("server:ssh");
	});

	it("names the required permission in the fallback denial message", () => {
		expect(permissionDeniedMessage("some_new_tool")).toContain("server:ssh");
	});

	it("produces a denial message for every mapped action", () => {
		for (const action of [
			"list_servers", "list_backups", "run_playbook", "query_traffic",
			"list_scheduled_tasks", "manage_cron", "search_knowledge",
			"list_files", "search_files", "read_file", "execute_command",
		]) {
			expect(permissionDeniedMessage(action)).toBeTruthy();
		}
	});
});

describe("isHostedActionType and SERVERLESS_ACTION_TYPES", () => {
	it("accepts a known action and rejects an unknown one", () => {
		expect(isHostedActionType("execute_command")).toBe(true);
		expect(isHostedActionType("rm_rf_slash")).toBe(false);
	});

	it("keeps every serverless action inside the hosted-action catalogue", () => {
		// A member of the serverless set that is not a hosted action type would be
		// unreachable — the entry point rejects it before the serverless
		// dispatcher ever sees it.
		for (const action of SERVERLESS_ACTION_TYPES) {
			expect(isHostedActionType(action)).toBe(true);
		}
	});

	it("does not list any command-executing action as serverless", () => {
		// Serverless actions skip the SSH path entirely; an executing action in
		// this set would bypass the approval and host-key machinery.
		for (const action of ["execute_command", "restart_service", "modify_config", "deploy_docker"]) {
			expect(SERVERLESS_ACTION_TYPES.has(action)).toBe(false);
		}
	});
});

describe("sessionForTeamScope", () => {
	it("normalises a missing currentTeamId to null", () => {
		expect(sessionForTeamScope({ userId: "u", roles: ["viewer"] as never })).toEqual({
			userId: "u",
			roles: ["viewer"],
			currentTeamId: null,
		});
	});

	it("returns null for an absent session instead of a partly-built object", () => {
		expect(sessionForTeamScope(null)).toBeNull();
		expect(sessionForTeamScope(undefined)).toBeNull();
	});
});

describe("resolveServerId", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.serverFindFirst.mockReset();
		mocks.serverFindFirst.mockResolvedValue(null);
	});

	it("checks an explicit id against the caller's team", async () => {
		mocks.serverFindFirst.mockResolvedValue({ id: "srv_1" });
		await expect(resolveServerId({ serverId: " srv_1 " }, operator)).resolves.toBe("srv_1");
		expect(mocks.serverFindFirst).toHaveBeenCalledWith({
			where: { id: "srv_1", teamId: "team_1" },
			select: { id: true },
		});
	});

	it("returns null for another team's id rather than the id itself", async () => {
		// The model can name any id; the answer has to come from the scoped query,
		// never be echoed back from the arguments.
		mocks.serverFindFirst.mockResolvedValue(null);
		await expect(resolveServerId({ serverId: "srv_other_team" }, operator)).resolves.toBeNull();
	});

	it("applies the team filter to the fuzzy name/host search too", async () => {
		mocks.serverFindFirst.mockResolvedValue({ id: "srv_1", name: "web", host: "h" });
		await resolveServerId({ serverQuery: "web" }, operator);
		const where = mocks.serverFindFirst.mock.calls[0]![0].where as { AND: unknown[] };
		expect(where.AND[0]).toEqual({ teamId: "team_1" });
		expect(where.AND[1]).toEqual({
			OR: [{ id: "web" }, { name: { contains: "web" } }, { host: { contains: "web" } }],
		});
	});

	it("quarantines legacy rows for a sessionless caller", async () => {
		await resolveServerId({ serverId: "srv_1" }, null);
		expect(mocks.serverFindFirst).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: "srv_1", teamId: null } }),
		);
	});

	it("lets a platform manager resolve any server", async () => {
		mocks.serverFindFirst.mockResolvedValue({ id: "srv_1" });
		await resolveServerId({ serverId: "srv_1" }, admin);
		expect(mocks.serverFindFirst).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: "srv_1" } }),
		);
	});

	it("returns null without querying when neither id nor query is usable", async () => {
		await expect(resolveServerId({}, operator)).resolves.toBeNull();
		await expect(resolveServerId({ serverQuery: "   " }, operator)).resolves.toBeNull();
		await expect(resolveServerId({ serverId: 42 as unknown as string }, operator)).resolves.toBeNull();
		expect(mocks.serverFindFirst).not.toHaveBeenCalled();
	});

	it("prefers an explicit id over a query and does not fall back on a miss", async () => {
		// Falling through to the fuzzy search after a failed id lookup would let a
		// foreign id smuggle in a same-named server from the caller's own team,
		// silently retargeting the action.
		mocks.serverFindFirst.mockResolvedValue(null);
		await expect(resolveServerId({ serverId: "srv_other", serverQuery: "web" }, operator)).resolves.toBeNull();
		expect(mocks.serverFindFirst).toHaveBeenCalledTimes(1);
	});
});

describe("resolvePlaybookId", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.playbookFindFirst.mockReset();
		mocks.playbookFindFirst.mockResolvedValue(null);
	});

	it("checks an explicit id under the strict playbook filter", async () => {
		mocks.playbookFindFirst.mockResolvedValue({ id: "pb_1", name: "deploy" });
		await expect(resolvePlaybookId({ playbookId: "pb_1" }, operator)).resolves.toEqual({ id: "pb_1", name: "deploy" });
		expect(mocks.playbookFindFirst).toHaveBeenCalledWith({
			where: { id: "pb_1", teamId: "team_1" },
			select: { id: true, name: true },
		});
	});

	it("scopes the fuzzy name search and takes the most recently updated match", async () => {
		mocks.playbookFindFirst.mockResolvedValue({ id: "pb_1", name: "deploy web" });
		await resolvePlaybookId({ playbookName: "deploy" }, operator);
		const call = mocks.playbookFindFirst.mock.calls[0]![0] as { where: { AND: unknown[] }; orderBy: unknown };
		expect(call.where.AND[0]).toEqual({ teamId: "team_1" });
		expect(call.orderBy).toEqual({ updatedAt: "desc" });
	});

	it("returns null without querying when no identifier is given", async () => {
		await expect(resolvePlaybookId({}, operator)).resolves.toBeNull();
		await expect(resolvePlaybookId({ playbookName: "  " }, operator)).resolves.toBeNull();
		expect(mocks.playbookFindFirst).not.toHaveBeenCalled();
	});

	it("applies no filter for a sessionless caller, unlike resolveServerId", async () => {
		// Recorded asymmetry: playbooks fall back to `{}` where servers fall back
		// to `{ teamId: null }`. Every request path supplies a session, so this
		// branch is reachable only from internal callers.
		await resolvePlaybookId({ playbookId: "pb_1" }, null);
		expect(mocks.playbookFindFirst).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: "pb_1" } }),
		);
	});
});
