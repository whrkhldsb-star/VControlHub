/**
 * Who holds a permission, as a Prisma `User` filter for recipient lookups
 * (approvers, on-call pools, budget managers). Platform administrators hold
 * every permission; a customer account holds what its identity template
 * grants, and only inside its own live customer.
 */
import type { Prisma } from "@prisma/client";

import type { Permission } from "./rbac";

export const PLATFORM_ADMIN_WHERE = { roles: { some: { role: { key: "admin" } } } } satisfies Prisma.UserWhereInput;

/** Customer accounts of `teamId` whose identity template grants `permission`. */
export function customerPermissionHoldersWhere(permission: Permission, teamId: string): Prisma.UserWhereInput {
	return {
		teamMembership: {
			is: { teamId, team: { deletedAt: null }, identityTemplate: { permissions: { has: permission } } },
		},
	};
}

/** Platform administrators plus, when `teamId` is set, that customer's holders. */
export function permissionHoldersWhere(permission: Permission, teamId: string | null | undefined): Prisma.UserWhereInput {
	if (!teamId) return PLATFORM_ADMIN_WHERE;
	return { OR: [PLATFORM_ADMIN_WHERE, customerPermissionHoldersWhere(permission, teamId)] };
}
