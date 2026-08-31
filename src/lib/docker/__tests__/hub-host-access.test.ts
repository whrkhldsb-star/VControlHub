import { describe, expect, it } from "vitest";

import { assertHubHostDockerAccess } from "../hub-host-access";
import type { SessionPayload } from "@/lib/auth/session";

/**
 * The hub host has no teamId, so the rule is the same one `serverTeamWhere`
 * applies to unassigned records: infrastructure that belongs to no team is for
 * platform managers, not implicitly shared with every tenant. `docker:manage`
 * alone is not enough — it ships in the default `operator` role.
 */
function session(overrides: Partial<SessionPayload>): SessionPayload {
	return {
		userId: "u_1",
		username: "op",
		roles: ["operator"],
		mustChangePassword: false,
		currentTeamId: "team_1",
		...overrides,
	} as SessionPayload;
}

describe("assertHubHostDockerAccess", () => {
	it("allows an admin", () => {
		expect(assertHubHostDockerAccess(session({ roles: ["admin"] })).ok).toBe(true);
	});

	it("allows a session whose explicit permissions include team:manage", () => {
		const actor = session({ permissions: ["docker:manage", "team:manage"] } as never);
		expect(assertHubHostDockerAccess(actor).ok).toBe(true);
	});

	it("refuses an operator, even one holding docker:manage", () => {
		const actor = session({ permissions: ["docker:manage"] } as never);
		const result = assertHubHostDockerAccess(actor);
		expect(result.ok).toBe(false);
	});

	it("refuses the default operator role", () => {
		expect(assertHubHostDockerAccess(session({})).ok).toBe(false);
	});

	it("refuses a missing session", () => {
		expect(assertHubHostDockerAccess(null).ok).toBe(false);
	});

	it("answers 403 with a permission code and an actionable message", async () => {
		const result = assertHubHostDockerAccess(session({}));
		if (result.ok) throw new Error("expected a refusal");
		expect(result.response.status).toBe(403);
		const body = await result.response.json();
		expect(body.code).toBe("PERMISSION_DENIED");
		// Mirrored into `error` for clients still reading the legacy field.
		expect(body.error).toBe(body.message);
		expect(body.message).toMatch(/server|服务器/);
	});
});
