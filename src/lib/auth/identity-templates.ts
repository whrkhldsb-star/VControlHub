/**
 * Customer accounts and identity templates.
 *
 * A platform administrator (role `admin`) works across every customer. Every
 * other account belongs to exactly one customer (a `Team` row) and its
 * permissions come only from the identity template on that membership —
 * account roles and direct grants do not apply to customer accounts.
 * Which servers a customer account reaches is narrowed per server with
 * `UserServerAccess` rows (no row = all of the customer's servers).
 *
 * Client-safe: no database imports.
 */
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, type Permission, type RoleKey } from "./rbac";

/** Platform-wide powers: never part of an identity template. */
export const PLATFORM_ONLY_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
	"announcement:manage",
	"backup:create",
	"backup:read",
	"backup:restore",
	"role:manage",
	"team:manage",
	"user:manage",
]);

/** Everything an identity template may grant inside its customer. */
export const CUSTOMER_PERMISSIONS: Permission[] = ALL_PERMISSIONS.filter((permission) => !PLATFORM_ONLY_PERMISSIONS.has(permission));

/** Every customer account may read its own customer and colleague directory. */
const CUSTOMER_BASE_PERMISSIONS: Permission[] = ["team:read", "user:read"];

const fromRole = (role: RoleKey) => DEFAULT_ROLE_PERMISSIONS[role].filter((permission) => !PLATFORM_ONLY_PERMISSIONS.has(permission));

export const BUILTIN_IDENTITY_TEMPLATES = [
	{ id: "identity:customer_admin", key: "customer_admin", permissions: CUSTOMER_PERMISSIONS },
	{ id: "identity:operator", key: "operator", permissions: fromRole("operator") },
	{ id: "identity:viewer", key: "viewer", permissions: fromRole("viewer") },
	{ id: "identity:files", key: "files", permissions: fromRole("storage_manager") },
] as const;

/** Identity template assigned when none is chosen. */
export const DEFAULT_IDENTITY_TEMPLATE_ID = "identity:viewer";

export function builtinIdentityTemplate(id: string) {
	return BUILTIN_IDENTITY_TEMPLATES.find((template) => template.id === id) ?? null;
}

/** Template permissions limited to what a customer account may hold. */
export function normalizeIdentityPermissions(raw: readonly string[]): Permission[] {
	const allowed = new Set<string>(CUSTOMER_PERMISSIONS);
	return CUSTOMER_PERMISSIONS.filter((permission) => raw.includes(permission) && allowed.has(permission));
}

/**
 * Effective permissions of a session.
 * - platform administrator: its account permissions (all of them);
 * - customer account in its customer: base + identity template;
 * - account without a customer: nothing beyond reading its own profile.
 */
export function resolveSessionPermissions(input: {
	roles: RoleKey[];
	accountPermissions: Permission[];
	identityPermissions: readonly string[] | null;
}): Permission[] {
	if (input.roles.includes("admin")) return input.accountPermissions;
	if (!input.identityPermissions) return ["user:read"];
	return Array.from(new Set([...CUSTOMER_BASE_PERMISSIONS, ...normalizeIdentityPermissions(input.identityPermissions)]));
}

/** Built-in templates are named in the viewer's language; custom ones as typed. */
export function identityTemplateName(
	template: { id: string; name: string; isBuiltin: boolean },
	t: (key: string) => string,
): string {
	const builtin = template.isBuiltin ? builtinIdentityTemplate(template.id) : null;
	return builtin ? t(`identityTemplate.${builtin.key}.name`) : template.name;
}
