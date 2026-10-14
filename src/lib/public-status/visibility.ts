/**
 * The single rule deciding whether a published node may be shown to
 * visitors. Every public read (list, summary, detail, history, availability)
 * goes through `VISIBLE_NODE_SQL` or `isPublicationVisible`, so a revocation,
 * a disabled or deleted server, a server moved to another customer, or a
 * deleted customer all stop the node everywhere at once.
 *
 * The SQL fragment expects the aliases used by the callers:
 *   n = public_status_nodes, s = servers, tm = teams (LEFT JOIN on s."teamId").
 */
import { Prisma } from "@prisma/client";

export const VISIBLE_NODE_SQL = Prisma.sql`n."published" = TRUE
	AND s."enabled" = TRUE
	AND s."teamId" IS NOT DISTINCT FROM n."publishedTeamId"
	AND (tm."id" IS NULL OR tm."deletedAt" IS NULL)`;

export type PublicationState = {
	published: boolean;
	publishedTeamId: string | null;
	server: { enabled: boolean; teamId: string | null; team: { deletedAt: Date | null } | null };
};

/** Why a publication is not visible; null when it is. */
export type HiddenReason = "unpublished" | "server_disabled" | "owner_changed" | "customer_deleted";

export function publicationHiddenReason(state: PublicationState): HiddenReason | null {
	if (!state.published) return "unpublished";
	if (!state.server.enabled) return "server_disabled";
	if ((state.server.teamId ?? null) !== (state.publishedTeamId ?? null)) return "owner_changed";
	if (state.server.team?.deletedAt) return "customer_deleted";
	return null;
}

export function isPublicationVisible(state: PublicationState): boolean {
	return publicationHiddenReason(state) === null;
}
