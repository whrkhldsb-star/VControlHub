import { afterEach, describe, expect, it } from "vitest";

import {
	loadSidebarDeclaredPermissions,
	resetDeclaredPermissionsCache,
} from "../declared-permissions";

describe("loadSidebarDeclaredPermissions", () => {
	afterEach(() => {
		resetDeclaredPermissionsCache();
	});

	it("returns an empty permission list for hrefs that are not present in the catalog", () => {
		const result = loadSidebarDeclaredPermissions(["/totally-unknown"]);
		expect(result["/totally-unknown"]).toEqual([]);
	});

	it("returns the declared permissions for a sidebar href backed by a page.tsx", () => {
		// `/files` declares storage:* + share:create per docs/route-catalog.json
		const result = loadSidebarDeclaredPermissions(["/files"]);
		expect(result["/files"]).toEqual(
			expect.arrayContaining(["share:create", "storage:delete", "storage:manage-node", "storage:write"]),
		);
	});

	it("returns an empty list for hrefs whose page declares no permissions (e.g. /dashboard)", () => {
		const result = loadSidebarDeclaredPermissions(["/dashboard"]);
		expect(result["/dashboard"]).toEqual([]);
	});

	it("preserves the full sidebar list when given multiple hrefs", () => {
		const result = loadSidebarDeclaredPermissions(["/dashboard", "/audit", "/users"]);
		expect(Object.keys(result).sort()).toEqual(["/audit", "/dashboard", "/users"]);
		expect(result["/users"] ?? []).toEqual(expect.arrayContaining(["user:manage", "user:read"]));
	});
});
