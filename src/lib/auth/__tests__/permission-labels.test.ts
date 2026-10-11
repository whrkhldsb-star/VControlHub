import { describe, expect, it } from "vitest";

import { en } from "@/lib/i18n/dictionaries/settings-page-en";
import { zh } from "@/lib/i18n/dictionaries/settings-page-zh";
import { groupPermissionsByDomain, permissionLabelKey } from "../permission-labels";
import { PERMISSIONS } from "../rbac";

describe("permission labels", () => {
	it("names every permission and domain in both languages", () => {
		for (const permission of PERMISSIONS) {
			expect(zh[permissionLabelKey(permission)], permission).toBeTruthy();
			expect(en[permissionLabelKey(permission)], permission).toBeTruthy();
		}
		for (const group of groupPermissionsByDomain(PERMISSIONS)) {
			expect(zh[group.labelKey], group.domain).toBeTruthy();
			expect(en[group.labelKey], group.domain).toBeTruthy();
		}
	});

	it("groups by the domain before the first colon, keeping order", () => {
		expect(groupPermissionsByDomain(["server:read", "storage:read", "server:sftp:unrestricted"])).toEqual([
			{ domain: "server", labelKey: "permissionDomain.server", permissions: ["server:read", "server:sftp:unrestricted"] },
			{ domain: "storage", labelKey: "permissionDomain.storage", permissions: ["storage:read"] },
		]);
		expect(permissionLabelKey("server:sftp:unrestricted")).toBe("permission.server.sftp.unrestricted");
	});
});
