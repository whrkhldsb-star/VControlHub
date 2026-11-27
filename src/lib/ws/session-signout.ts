/**
 * Sign-out fan-out to live sockets, without a session table.
 *
 * Session cookies are stateless, so signing out one device has nothing to
 * revoke in the database (bumping `User.sessionEpoch` would sign out every
 * device). What a single-device sign-out must still end is what this cookie
 * opened and keeps open on its own: the notification socket, remote desktops,
 * terminals, and keep-alive shells waiting detached for a reconnect. Each of
 * those re-checks the session only periodically, and a detached shell has no
 * socket to re-check at all.
 *
 * `/api/auth/signout` publishes the signed-out cookie's digest on the
 * notification bus (Redis pub/sub, PostgreSQL NOTIFY or in-process, whichever
 * the deployment runs), which every web instance and the terminal gateway
 * subscribe to. Each process hands it to the handlers registered here, and
 * those close what is bound to that exact cookie; the user's other sessions
 * stay untouched. Only the digest travels: the cookie itself never leaves the
 * request that carried it.
 */
import { createHash } from "node:crypto";

import { createLogger } from "@/lib/logging";
import { getNotificationBus } from "./notification-bus";

const logger = createLogger("ws:session-signout");

/** Bus message type; never a notification, so it is never pushed to a browser. */
export const SESSION_SIGNOUT_MESSAGE_TYPE = "session_signout";

export type SessionSignoutMessage = { type: typeof SESSION_SIGNOUT_MESSAGE_TYPE; tokenHash: string };

/** The digest sockets and shells are bound to: one-way, so a leaked bus message names no usable credential. */
export function sessionTokenHash(token: string): string {
	return createHash("sha256").update(`vch-session-signout:${token}`).digest("hex");
}

/** Tell every process that this session cookie was signed out. */
export function publishSessionSignout(userId: string, token: string): void {
	const message: SessionSignoutMessage = { type: SESSION_SIGNOUT_MESSAGE_TYPE, tokenHash: sessionTokenHash(token) };
	getNotificationBus().publish(userId, message);
}

/** The digest a sign-out message carries; null for anything else. */
export function readSessionSignout(message: unknown): string | null {
	if (!message || typeof message !== "object") return null;
	const { type, tokenHash } = message as { type?: unknown; tokenHash?: unknown };
	return type === SESSION_SIGNOUT_MESSAGE_TYPE && typeof tokenHash === "string" && /^[a-f0-9]{64}$/.test(tokenHash)
		? tokenHash
		: null;
}

type SignoutHandler = (userId: string, tokenHash: string) => void;
const handlers = new Set<SignoutHandler>();

/** Close what this process holds for a signed-out cookie. Returns the unsubscribe function. */
export function onSessionSignout(handler: SignoutHandler): () => void {
	handlers.add(handler);
	return () => {
		handlers.delete(handler);
	};
}

/**
 * Hand a bus message to this process's sign-out handlers. True when the
 * message was a sign-out (and so is not a notification to broadcast).
 */
export function deliverSessionSignout(userId: string, message: unknown): boolean {
	const tokenHash = readSessionSignout(message);
	if (!tokenHash) return false;
	for (const handler of [...handlers]) {
		try {
			handler(userId, tokenHash);
		} catch (error) {
			logger.warn("session sign-out handler failed", { error: error instanceof Error ? error.message : String(error) });
		}
	}
	return true;
}
