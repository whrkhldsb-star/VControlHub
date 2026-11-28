import { sessionHasPermission } from "@/lib/auth/authorization";
import type { SelfReviewPolicy } from "./approval-policy";

type PermissionSession = Parameters<typeof sessionHasPermission>[0];

/**
 * Separation of duties: whoever filed a command request does not approve or reject it, unless they also manage
 * the team (single-operator deployment) or the platform explicitly enables `command.selfReview = "approvers"`
 * for accounts holding `command:approve`.
 */
export function maySelfReviewCommands(
	session: PermissionSession | null | undefined,
	selfReviewPolicy: SelfReviewPolicy = "platform_admins",
): boolean {
	if (!session) return false;
	if (sessionHasPermission(session, "team:manage")) return true;
	return selfReviewPolicy === "approvers" && sessionHasPermission(session, "command:approve");
}

/**
 * Whether this account may approve or reject a request filed by `requesterId`: what reviewCommandRequest accepts.
 * The pages offer a review, and count a request as waiting for this account, only where it holds.
 */
export function mayReviewCommandRequest(
	session: PermissionSession & { userId: string },
	requesterId: string,
	runInitiatorId?: string | null,
	unattributedManualRun = false,
	selfReviewPolicy: SelfReviewPolicy = "platform_admins",
): boolean {
	return sessionHasPermission(session, "command:approve") && (
		(!unattributedManualRun && session.userId !== requesterId && session.userId !== runInitiatorId) ||
		maySelfReviewCommands(session, selfReviewPolicy)
	);
}

const CANCELLABLE_COMMAND_STATUSES = new Set(["PENDING_APPROVAL", "APPROVED", "RUNNING"]);

/**
 * Shared cancellation authorization predicate matching `cancelCommandRequest`
 * (`PATCH /api/commands`):
 * - Only `PENDING_APPROVAL`, `APPROVED`, or `RUNNING` requests may be cancelled.
 * - A requester with `command:create` may withdraw their OWN `PENDING_APPROVAL` request.
 * - Stopping an approved/running command (or anyone else's request) requires `command:execute`,
 *   and cancelling someone else's request additionally requires `command:approve` or `team:manage`.
 */
export function mayCancelCommandRequest(
	session: PermissionSession & { userId: string },
	request: { status: string; requesterId: string | null | undefined },
): boolean {
	if (!CANCELLABLE_COMMAND_STATUSES.has(request.status)) return false;
	const own = request.requesterId === session.userId;
	const canExecute = sessionHasPermission(session, "command:execute");
	const canCancelOthers =
		canExecute &&
		(sessionHasPermission(session, "command:approve") || sessionHasPermission(session, "team:manage"));
	if (canCancelOthers) return true;
	if (own && canExecute) return true;
	return own && request.status === "PENDING_APPROVAL" && sessionHasPermission(session, "command:create");
}
