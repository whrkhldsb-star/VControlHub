import { describe, expect, it } from "vitest";

import { mayReviewCommandRequest, maySelfReviewCommands } from "../review-scope";

const session = (userId: string, permissions: string[]) => ({ userId, roles: [], permissions }) as never;

describe("command review scope", () => {
	it("needs the approve permission", () => {
		expect(mayReviewCommandRequest(session("u_1", ["command:read"]), "u_2")).toBe(false);
		expect(mayReviewCommandRequest(session("u_1", ["command:read", "command:approve"]), "u_2")).toBe(true);
	});

	it("sends a reviewer's own request to someone else, unless they manage the team", () => {
		expect(mayReviewCommandRequest(session("u_1", ["command:approve"]), "u_1")).toBe(false);
		// team:manage belongs to the platform role: a template that lists it does not carry it.
		expect(mayReviewCommandRequest(session("u_1", ["command:approve", "team:manage"]), "u_1")).toBe(false);
		expect(mayReviewCommandRequest({ userId: "u_1", roles: ["admin"] }, "u_1")).toBe(true);
		expect(maySelfReviewCommands(null)).toBe(false);
		expect(maySelfReviewCommands({ roles: ["admin"] })).toBe(true);
	});
});
