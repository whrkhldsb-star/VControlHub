import { describe, expect, it } from "vitest";

import { en } from "@/lib/i18n/dictionaries/settings-page-en";
import { zh } from "@/lib/i18n/dictionaries/settings-page-zh";
import { browserT } from "@/lib/i18n/browser-translations";
import { groupPermissionsByDomain, permissionGroupName, permissionLabelKey } from "../permission-labels";
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

	it("shows built-in groups that keep a preset name in the viewer's language", () => {
		const toEn = (key: string) => browserT(key, "en");
		expect(permissionGroupName({ name: "日常运维", isBuiltin: true }, toEn)).toBe("Day-to-day operations");
		expect(permissionGroupName({ name: "Storage manager", isBuiltin: true }, (key) => browserT(key, "zh"))).toBe("云盘管理员");
		expect(permissionGroupName({ name: "夜班运维", isBuiltin: true }, toEn)).toBe("夜班运维");
		expect(permissionGroupName({ name: "日常运维", isBuiltin: false }, toEn)).toBe("日常运维");
	});
});
