import { loadApiTokenOwnerSession } from "@/lib/api-token/authorization";
import { sessionHasPermission } from "@/lib/auth/authorization";
import type { Permission } from "@/lib/auth/rbac";
import type { SessionPayload } from "@/lib/auth/session";
import { serverTeamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { t } from "@/lib/i18n/service-translations";
import { assertStorageAccess } from "@/lib/storage/access-control";

/** The creator's current session for the job's customer; null once it may no longer act. */
export async function loadExecutionActor(createdBy: string | null | undefined, teamId: string | null | undefined) {
	return createdBy ? loadApiTokenOwnerSession(createdBy, teamId ?? undefined) : null;
}

/**
 * Background work (a scheduled sync, a queued download) acts with the rights
 * its owner has now, not the ones they had when they created it: a disabled
 * account, a revoked permission, or a server that was disabled or moved to
 * another customer stops it before the platform's credentials are used.
 *
 * `actor` is the person running it now (a manual run) or the creator already
 * loaded with loadExecutionActor (null: inactive); left out, the creator's
 * current session for the job's customer is loaded here.
 * Returns why the work must not run, or null when it may.
 */
export async function executionRefusal(input: {
	actor?: SessionPayload | null;
	createdBy: string | null | undefined;
	teamId: string | null | undefined;
	permission: Permission;
	serverIds: string[];
	/** A storage path the work writes to: the owner's path grants must still allow it. */
	writesTo?: { storageNodeId: string; relativePath: string };
}): Promise<string | null> {
	const actor = input.actor === undefined ? await loadExecutionActor(input.createdBy, input.teamId) : input.actor;
	if (!actor) return t("backend.execution.ownerInactive");
	if (!sessionHasPermission(actor, input.permission)) return t("backend.execution.permissionRevoked");
	const serverIds = Array.from(new Set(input.serverIds.filter(Boolean)));
	const usable = await prisma.server.count({
		where: { id: { in: serverIds }, enabled: true, ...serverTeamWhere(actor, "connect") },
	});
	if (usable !== serverIds.length) return t("backend.execution.serverUnavailable");
	if (input.writesTo) {
		const access = await assertStorageAccess({ session: actor, ...input.writesTo, operation: "write" });
		if (!access.allowed) return t("backend.execution.storageRevoked");
	}
	return null;
}
