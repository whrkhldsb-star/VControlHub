import { describe, expect, it } from "vitest";
import {
	BUILTIN_IDENTITY_TEMPLATES,
	CUSTOMER_PERMISSIONS,
	identityTemplateName,
	normalizeIdentityPermissions,
	PLATFORM_ONLY_PERMISSIONS,
	resolveSessionPermissions,
} from "../identity-templates";
import { ALL_PERMISSIONS } from "../rbac";

describe("identity templates", () => {
	it("never lets a template carry a platform-only permission", () => {
		for (const permission of PLATFORM_ONLY_PERMISSIONS) expect(CUSTOMER_PERMISSIONS).not.toContain(permission);
		for (const template of BUILTIN_IDENTITY_TEMPLATES) {
			for (const permission of template.permissions) expect(PLATFORM_ONLY_PERMISSIONS.has(permission)).toBe(false);
		}
		expect(normalizeIdentityPermissions(["user:manage", "server:read", "made:up"])).toEqual(["server:read"]);
	});

	it("gives an administrator every permission and ignores templates", () => {
		expect(resolveSessionPermissions({ roles: ["admin"], accountPermissions: ALL_PERMISSIONS, identityPermissions: ["server:read"] })).toEqual(ALL_PERMISSIONS);
	});

	it("gives a customer account exactly its template plus reading its customer", () => {
		const permissions = resolveSessionPermissions({ roles: ["operator"], accountPermissions: [], identityPermissions: ["server:ssh"] });
		expect(permissions.sort()).toEqual(["server:ssh", "team:read", "user:read"]);
	});

	it("leaves an account without a customer able to read only its own profile", () => {
		expect(resolveSessionPermissions({ roles: [], accountPermissions: [], identityPermissions: null })).toEqual(["user:read"]);
	});

	it("names built-in templates in the viewer's language and custom ones as typed", () => {
		const t = (key: string) => `t(${key})`;
		expect(identityTemplateName({ id: "identity:operator", name: "客户运维", isBuiltin: true }, t)).toBe("t(identityTemplate.operator.name)");
		expect(identityTemplateName({ id: "custom_1", name: "夜班", isBuiltin: false }, t)).toBe("夜班");
	});
});
