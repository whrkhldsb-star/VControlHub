import { sessionHasPermission } from "@/lib/auth/authorization";
import {
	DEFAULT_ROLE_PERMISSIONS,
	PERMISSIONS,
	type Permission,
	type RoleKey,
} from "@/lib/auth/rbac";
import type { SessionPayload } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

const PUBLIC_TOKEN_SCOPES = new Set(["status:read"]);
const PERMISSION_SET = new Set<string>(PERMISSIONS);

export function tokenAllowsPermission(
	scopes: string[],
	permission: Permission,
): boolean {
	return (
		scopes.includes(permission) ||
		(permission.endsWith(":read") && scopes.includes("read"))
	);
}

export function apiTokenScopeAllowedForSession(
	scope: string,
	session: SessionPayload,
): boolean {
	if (scope === "read") {
		return true;
	}
	if (PUBLIC_TOKEN_SCOPES.has(scope)) {
		return true;
	}
	if (!PERMISSION_SET.has(scope)) {
		return false;
	}
	return sessionHasPermission(session, scope as Permission);
}

export async function loadApiTokenOwnerSession(
	userId: string,
): Promise<SessionPayload | null> {
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: {
			id: true,
			username: true,
			status: true,
			mustChangePassword: true,
			currentTeamId: true,
			roles: { select: { role: { select: { key: true } } } },
		},
	});
	if (!user || user.status === "DISABLED" || user.mustChangePassword) {
		return null;
	}
	const roles = user.roles
		.map((entry) => entry.role.key)
		.filter((key): key is RoleKey => key in DEFAULT_ROLE_PERMISSIONS);
	return {
		userId: user.id,
		username: user.username,
		roles,
		mustChangePassword: false,
		currentTeamId: user.currentTeamId ?? null,
	};
}
