import { sessionHasPermission } from "@/lib/auth/authorization";

type PermissionSession = Parameters<typeof sessionHasPermission>[0];

/**
 * Separation of duties: whoever filed a command request does not approve or reject it, unless they also manage
 * the team — a single-operator deployment has no second reviewer.
 */
export function maySelfReviewCommands(session: PermissionSession | null | undefined): boolean {
	return Boolean(session && sessionHasPermission(session, "team:manage"));
}

/**
 * Whether this account may approve or reject a request filed by `requesterId`: what reviewCommandRequest accepts.
 * The pages offer a review, and count a request as waiting for this account, only where it holds.
 */
export function mayReviewCommandRequest(session: PermissionSession & { userId: string }, requesterId: string): boolean {
	return sessionHasPermission(session, "command:approve") && (requesterId !== session.userId || maySelfReviewCommands(session));
}
