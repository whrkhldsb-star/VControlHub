import { describe, expect, it } from "vitest";

/**
 * Tests for `assertAiOpsPlatformReader`.
 *
 * AI-ops scans collect fleet-health signals across every team and `AiOpsLog` has
 * no `teamId`, so its logs and summary are inherently cross-tenant. Reading them
 * is therefore gated on `team:manage` — a platform-admin capability — *in
 * addition to* the route's `ai:ops:read` permission. The module's own comment
 * calls this defence in depth: a custom DB role mis-granted `ai:ops:read` still
 * must not read cross-team aggregates.
 *
 * The `team-scope` and `authorization` modules are kept real so the permission
 * derivation is the production one.
 */
import { ForbiddenError } from "@/lib/errors";
import { assertAiOpsPlatformReader } from "../authorization";

type Session = Parameters<typeof assertAiOpsPlatformReader>[0];

function session(overrides: Partial<NonNullable<Session>> = {}): Session {
	return {
		userId: "u_1",
		username: "op",
		roles: ["operator"],
		mustChangePassword: false,
		currentTeamId: "team_1",
		...overrides,
	} as NonNullable<Session>;
}

describe("assertAiOpsPlatformReader", () => {
	it("allows a caller holding team:manage", () => {
		expect(() =>
			assertAiOpsPlatformReader(session({ permissions: ["team:manage"] } as never)),
		).not.toThrow();
	});

	it("allows an admin, who holds team:manage through their role", () => {
		expect(() => assertAiOpsPlatformReader(session({ roles: ["admin"] }))).not.toThrow();
	});

	it("refuses a caller who has ai:ops:read but not team:manage", () => {
		// The defence-in-depth case: a custom role mis-granted ai:ops:read still
		// cannot read another team's fleet aggregates.
		expect(() =>
			assertAiOpsPlatformReader(session({ permissions: ["ai:ops:read"] } as never)),
		).toThrow(ForbiddenError);
	});

	it("refuses a plain operator", () => {
		expect(() => assertAiOpsPlatformReader(session())).toThrow(ForbiddenError);
	});

	it("refuses a viewer", () => {
		expect(() => assertAiOpsPlatformReader(session({ roles: ["viewer"] }))).toThrow(ForbiddenError);
	});

	it("refuses an absent session rather than treating it as internal", () => {
		expect(() => assertAiOpsPlatformReader(null)).toThrow(ForbiddenError);
	});

	it("throws a 403-mapping error, not a bare Error", () => {
		// A plain Error would reach apiCatch's 500 branch and read as an outage.
		try {
			assertAiOpsPlatformReader(session());
			throw new Error("expected a refusal");
		} catch (error) {
			expect((error as { status?: number }).status).toBe(403);
		}
	});

	it("returns void on success rather than a result object callers might ignore", () => {
		expect(assertAiOpsPlatformReader(session({ roles: ["admin"] }))).toBeUndefined();
	});
});
