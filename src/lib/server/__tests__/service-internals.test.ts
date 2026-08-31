import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for `src/lib/server/service-internals.ts` — the shared helpers behind
 * server create/update.
 *
 * `assertNoDuplicateServerHost` is the one with a security contract. Its error
 * message names the colliding node and its `user@host:port`, so the lookup must
 * stay inside the caller's tenant: `server:write` is an ordinary operator
 * permission and `host` is the only input, so an unscoped query turns "add a
 * VPS" into a probe that reports another team's node name and SSH user for any
 * IP the attacker guesses. `serverTeamWhere` — not the loose `teamWhere` — is
 * the right filter, matching how every other query on this model treats a
 * `teamId: null` row as quarantined legacy data rather than a shared node.
 *
 * `team-scope` is kept real so the filter shapes are the production ones.
 */
const mocks = vi.hoisted(() => ({
	findFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
	prisma: { server: { findFirst: mocks.findFirst } },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
	assertNoDuplicateServerHost,
	buildDuplicateServerError,
	buildServerConnectionTypeLabel,
	buildServerStatusLabel,
	formatServerEndpoint,
	isLocalHostLiteral,
	serializeDate,
} from "../service-internals";

type Normalized = Parameters<typeof assertNoDuplicateServerHost>[0];

/** Only `host` is read by the duplicate check; the rest satisfies the type. */
const normalized = {
	name: "web-01",
	host: "203.0.113.10",
	port: 22,
	username: "root",
} as unknown as Normalized;

const operator = {
	userId: "u_1",
	roles: ["operator"] as never,
	currentTeamId: "team_1",
};

describe("assertNoDuplicateServerHost", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.findFirst.mockReset();
		mocks.findFirst.mockResolvedValue(null);
	});

	it("scopes the lookup to the caller's team", async () => {
		await assertNoDuplicateServerHost(normalized, { session: operator });
		expect(mocks.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { host: "203.0.113.10", teamId: "team_1" },
			}),
		);
	});

	it("does not report another team's node as a duplicate", async () => {
		// The query carries the team filter, so a foreign row simply is not found.
		// Without the filter the thrown message would disclose that team's node
		// name and `user@host:port` to anyone holding server:write.
		mocks.findFirst.mockResolvedValue(null);
		await expect(assertNoDuplicateServerHost(normalized, { session: operator })).resolves.toBeUndefined();
	});

	it("still reports a duplicate inside the caller's own team", async () => {
		mocks.findFirst.mockResolvedValue({
			id: "srv_existing",
			name: "web-01",
			host: "203.0.113.10",
			port: 22,
			username: "root",
			enabled: true,
		});
		await expect(assertNoDuplicateServerHost(normalized, { session: operator })).rejects.toMatchObject({
			status: 409,
		});
	});

	it("treats a teamless caller as colliding with nothing rather than with every legacy row", async () => {
		// `serverTeamWhere` quarantines teamId:null: the sentinel id matches no row.
		// Failing this direction is safe — host uniqueness is a UX guard against
		// managing one box twice (the column has no @@unique), not an invariant.
		await assertNoDuplicateServerHost(normalized, {
			session: { userId: "u_2", roles: ["operator"] as never, currentTeamId: null },
		});
		expect(mocks.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ id: "__unassigned_servers_require_team_manage__" }),
			}),
		);
	});

	it("lets a platform manager see every team's hosts", async () => {
		// A global manager legitimately administers the whole fleet, so the
		// duplicate warning is useful rather than a disclosure.
		await assertNoDuplicateServerHost(normalized, {
			session: { userId: "admin", roles: ["admin"] as never, currentTeamId: null },
		});
		expect(mocks.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({ where: { host: "203.0.113.10" } }),
		);
	});

	it("excludes the row being edited so an update is not its own duplicate", async () => {
		await assertNoDuplicateServerHost(normalized, { excludeId: "srv_self", session: operator });
		expect(mocks.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { host: "203.0.113.10", teamId: "team_1", id: { not: "srv_self" } },
			}),
		);
	});

	it("applies no team filter when no session is supplied", async () => {
		// Maintenance scripts and system callers pass none; documenting this keeps
		// the "sessionless means unscoped" behaviour a deliberate choice rather
		// than an accident a future edit can reintroduce at a request path.
		await assertNoDuplicateServerHost(normalized);
		expect(mocks.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({ where: { host: "203.0.113.10" } }),
		);
	});

	it("selects only the fields the error message needs", async () => {
		await assertNoDuplicateServerHost(normalized, { session: operator });
		const select = mocks.findFirst.mock.calls[0]![0].select as Record<string, boolean>;
		expect(Object.keys(select).sort()).toEqual(["enabled", "host", "id", "name", "port", "username"]);
	});
});

describe("buildDuplicateServerError", () => {
	it("names the colliding node and its endpoint", () => {
		const message = buildDuplicateServerError({
			id: "srv_1",
			name: "web-01",
			host: "203.0.113.10",
			port: 2222,
			username: "deploy",
			enabled: true,
		});
		expect(message).toContain("web-01");
		expect(message).toContain("deploy@203.0.113.10:2222");
	});
});

describe("small helpers", () => {
	it("formats an endpoint as user@host:port", () => {
		expect(formatServerEndpoint({ host: "h", port: 22, username: "root" })).toBe("root@h:22");
	});

	it.each([
		["127.0.0.1", true],
		["localhost", true],
		["LOCALHOST", true],
		["::1", true],
		["0.0.0.0", true],
		["  127.0.0.1  ", true],
		["203.0.113.10", false],
		["127.0.0.2", false],
		["localhost.evil.test", false],
	])("isLocalHostLiteral(%s) === %s", (host, expected) => {
		expect(isLocalHostLiteral(host)).toBe(expected);
	});

	it("serializes a Date but passes a string through unchanged", () => {
		expect(serializeDate(new Date("2026-08-31T00:00:00.000Z"))).toBe("2026-08-31T00:00:00.000Z");
		expect(serializeDate("already-a-string")).toBe("already-a-string");
	});

	it("labels enabled state and connection type", () => {
		expect(buildServerStatusLabel(true)).toBe("Enabled");
		expect(buildServerStatusLabel(false)).toBe("Disabled");
		expect(buildServerConnectionTypeLabel("SSH_KEY")).toBe("SSH key");
		expect(buildServerConnectionTypeLabel("PASSWORD")).toBe("Password");
	});
});
