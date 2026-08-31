import { describe, expect, it } from "vitest";

/**
 * Tests for `src/lib/team/schema.ts`.
 *
 * The load-bearing rule is the slug regex `^[a-z0-9][a-z0-9-]*$`. Deleted teams
 * are tombstoned by rewriting their slug to `__deleted__<slug>` (see
 * `isDeletedTeamSlug` in the service), and `listTeamsForSession` filters those
 * out with a `startsWith` NOT clause. A slug that may begin with `_` would let a
 * caller create a team that every listing hides — so the regex is the first of
 * two guards, the service's own `isDeletedTeamSlug` check on create being the
 * second. Both are worth pinning; this file covers the schema half.
 */
import {
	addTeamMemberSchema,
	createTeamSchema,
	switchTeamSchema,
	updateTeamSchema,
} from "../schema";

describe("createTeamSchema", () => {
	it("accepts a name with an optional slug and description", () => {
		const parsed = createTeamSchema.parse({ name: "  Ops  ", slug: "ops-team", description: " the team " });
		expect(parsed).toEqual({ name: "Ops", slug: "ops-team", description: "the team" });
	});

	it("treats the slug as optional", () => {
		expect(createTeamSchema.parse({ name: "Ops" })).toEqual({ name: "Ops" });
	});

	it("rejects a tombstone-shaped slug so a hidden team cannot be created", () => {
		// `__deleted__*` slugs are filtered out of every team listing; a team
		// wearing one would exist but be invisible in the UI.
		expect(createTeamSchema.safeParse({ name: "Ghost", slug: "__deleted__ghost" }).success).toBe(false);
		expect(createTeamSchema.safeParse({ name: "Ghost", slug: "_ops" }).success).toBe(false);
	});

	it("rejects a slug that does not start with a letter or digit", () => {
		for (const slug of ["-ops", "_ops", ".ops"]) {
			expect(createTeamSchema.safeParse({ name: "T", slug }).success).toBe(false);
		}
	});

	it("trims surrounding whitespace before applying the regex", () => {
		// `.trim()` runs first, so " ops " is a valid slug rather than a leading-
		// space rejection — worth stating because the two read the same at a glance.
		expect(createTeamSchema.parse({ name: "T", slug: " ops " }).slug).toBe("ops");
	});

	it("rejects uppercase and other characters in a slug", () => {
		for (const slug of ["Ops", "ops team", "ops/team", "ops_team", "ops.team", "团队"]) {
			expect(createTeamSchema.safeParse({ name: "T", slug }).success).toBe(false);
		}
	});

	it("accepts internal hyphens and digits", () => {
		for (const slug of ["ops", "ops-team", "ops-team-2", "0ps", "a"]) {
			expect(createTeamSchema.safeParse({ name: "T", slug }).success).toBe(true);
		}
	});

	it("rejects a blank or whitespace-only name", () => {
		expect(createTeamSchema.safeParse({ name: "" }).success).toBe(false);
		expect(createTeamSchema.safeParse({ name: "   " }).success).toBe(false);
	});

	it("enforces the length caps", () => {
		expect(createTeamSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
		expect(createTeamSchema.safeParse({ name: "T", slug: `a${"b".repeat(64)}` }).success).toBe(false);
		expect(createTeamSchema.safeParse({ name: "T", description: "d".repeat(301) }).success).toBe(false);
	});

	it("allows an explicitly null description", () => {
		expect(createTeamSchema.parse({ name: "T", description: null })).toEqual({ name: "T", description: null });
	});
});

describe("updateTeamSchema", () => {
	it("makes every field optional so a partial update is legal", () => {
		expect(updateTeamSchema.parse({})).toEqual({});
		expect(updateTeamSchema.parse({ name: "New" })).toEqual({ name: "New" });
	});

	it("does not accept a slug, so a rename cannot escape the tombstone filter", () => {
		// Slugs are immutable after creation; a smuggled one is stripped rather
		// than applied.
		const parsed = updateTeamSchema.parse({ name: "T", slug: "__deleted__x" } as never);
		expect(parsed).not.toHaveProperty("slug");
	});

	it("still rejects a blank name when one is supplied", () => {
		expect(updateTeamSchema.safeParse({ name: "  " }).success).toBe(false);
	});
});

describe("switchTeamSchema", () => {
	it("requires a non-blank teamId", () => {
		expect(switchTeamSchema.parse({ teamId: " team_1 " })).toEqual({ teamId: "team_1" });
		expect(switchTeamSchema.safeParse({ teamId: "   " }).success).toBe(false);
		expect(switchTeamSchema.safeParse({}).success).toBe(false);
	});
});

describe("addTeamMemberSchema", () => {
	it("defaults the role to member rather than admin", () => {
		// Getting this default wrong would silently promote every added member.
		expect(addTeamMemberSchema.parse({ username: "alice" })).toEqual({ username: "alice", role: "member" });
	});

	it("accepts only admin or member", () => {
		expect(addTeamMemberSchema.parse({ username: "a", role: "admin" }).role).toBe("admin");
		for (const role of ["owner", "superadmin", "ADMIN", ""]) {
			expect(addTeamMemberSchema.safeParse({ username: "a", role }).success).toBe(false);
		}
	});

	it("requires a username", () => {
		expect(addTeamMemberSchema.safeParse({ role: "member" }).success).toBe(false);
		expect(addTeamMemberSchema.safeParse({ username: "  " }).success).toBe(false);
	});
});
