import { sessionHasPermission } from "@/lib/auth/authorization";
import {
	DEFAULT_ROLE_PERMISSIONS,
	PERMISSIONS,
	type Permission,
	type RoleKey,
} from "@/lib/auth/rbac";
import { getPermissionsFromRoles } from "@/lib/auth/rbac";
import { resolveSessionPermissions } from "@/lib/auth/identity-templates";
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
	boundTeamId?: string,
): Promise<SessionPayload | null> {
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: {
			id: true,
			username: true,
			status: true,
			mustChangePassword: true,
			currentTeamId: true,
			teamMembership: {
				select: { teamId: true, team: { select: { deletedAt: true } }, identityTemplate: { select: { permissions: true } } },
			},
			roles: { select: { role: { select: { key: true } } } },
		},
	});
	if (!user || user.status === "DISABLED" || user.mustChangePassword) {
		return null;
	}
	const assignedRoleKeys = user.roles.map((entry) => entry.role.key);
	const roles = assignedRoleKeys.filter(
		(key): key is RoleKey => key in DEFAULT_ROLE_PERMISSIONS,
	);
	const accountPermissions = getPermissionsFromRoles(roles);
	const isAdmin = roles.includes("admin");
	const membership = user.teamMembership && !user.teamMembership.team.deletedAt ? user.teamMembership : null;
	// Bearer/WebDAV credentials carry an immutable customer. Removing the owner
	// from it, or deleting the customer, invalidates the credential at once.
	let currentTeamId: string | null;
	if (isAdmin) {
		const teamId = boundTeamId ?? user.currentTeamId;
		const team = teamId ? await prisma.team.findUnique({ where: { id: teamId }, select: { deletedAt: true } }) : null;
		currentTeamId = team && !team.deletedAt ? teamId : null;
	} else {
		currentTeamId = membership && (!boundTeamId || membership.teamId === boundTeamId) ? membership.teamId : null;
	}
	if (boundTeamId && currentTeamId !== boundTeamId) return null;
	const permissions = resolveSessionPermissions({
		roles,
		accountPermissions,
		identityPermissions: !isAdmin && membership ? membership.identityTemplate.permissions : null,
	});
	return {
		userId: user.id,
		username: user.username,
		roles,
		permissions,
		mustChangePassword: false,
		currentTeamId,
	};
}
