import { describe, expect, it } from "vitest";
import { customerPermissionHoldersWhere, permissionHoldersWhere, PLATFORM_ADMIN_WHERE } from "../permission-holders";

describe("permission holders", () => {
	it("limits a null-team lookup to platform administrators", () => {
		expect(permissionHoldersWhere("command:approve", null)).toEqual(PLATFORM_ADMIN_WHERE);
	});

	it("adds the live customer's accounts whose template grants the permission", () => {
		expect(permissionHoldersWhere("cost:manage", "team_a")).toEqual({
			OR: [PLATFORM_ADMIN_WHERE, customerPermissionHoldersWhere("cost:manage", "team_a")],
		});
		expect(customerPermissionHoldersWhere("cost:manage", "team_a")).toEqual({
			teamMembership: { is: { teamId: "team_a", team: { deletedAt: null }, identityTemplate: { permissions: { has: "cost:manage" } } } },
		});
	});
});
