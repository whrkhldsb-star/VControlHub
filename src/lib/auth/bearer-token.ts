/**
 * Bearer token authentication for API routes.
 * Allows API Token holders (e.g. image:read, image:write) to access
 * endpoints without a session cookie.
 *
 * Usage in route.ts:
 *   const tokenAuth = await verifyBearerToken(request, "image:read");
 *   if (tokenAuth) { /* use tokenAuth.userId, tokenAuth.scopes *\/ }
 */
import { verifyApiToken } from "@/lib/api-token/service";
import {
	loadApiTokenOwnerSession,
	tokenAllowsPermission,
} from "@/lib/api-token/authorization";
import { sessionHasPermission } from "./authorization";
import { canRouteValidateBearerToken } from "./bearer-route-policy";
import { PLATFORM_ONLY_PERMISSIONS } from "./identity-templates";
import type { Permission } from "./rbac";
import type { SessionPayload } from "./session";
import { t } from "@/lib/i18n/service-translations";
import { rateLimitResponse } from "@/lib/http/rate-limit-presets";
import {
	getClientIp,
	isCredentialClientBlockedAsync,
	recordUnknownCredentialAsync,
} from "@/lib/rate-limit";

/** Unknown-credential counter shared by every token-authenticated API route (WebDAV keeps its own). */
const UNKNOWN_TOKEN_SCOPE = "api-token";

export type BearerTokenResult = {
	userId: string;
	scopes: string[];
	tokenId: string;
	session: SessionPayload;
};

// A queued operation may need to revalidate the exact credential after the
// request ends. Keep its database id out of serialized session objects.
const verifiedBearerIds = new WeakMap<object, string>();

export function verifiedBearerTokenId(session: object): string | null {
	return verifiedBearerIds.get(session) ?? null;
}

const SAFE_TOKEN_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function requestPathname(request: Request): string {
	try {
		return new URL(request.url).pathname;
	} catch {
		return "";
	}
}

export function hasBearerAuthorization(request: Request): boolean {
	return /^Bearer\s+/i.test(request.headers.get("authorization") ?? "");
}

export async function authenticateBearerForPermissions(
	request: Request,
	requiredPermissions: Permission[],
	optionalPermissions: Permission[] = [],
): Promise<
	| { session: SessionPayload; scopes: string[]; tokenId: string }
	| Response
	| null
> {
	if (!hasBearerAuthorization(request)) return null;
	// The proxy's bearer policy, enforced again here: the proxy lets a request through on a plausible-looking
	// session cookie and a matching CSRF pair, both of which a script can fake, so a token presented to a route
	// that does not take tokens for this method must be refused by the route itself. Checked before the token
	// lookup, so such requests cost no query either.
	if (!canRouteValidateBearerToken(requestPathname(request), request.method)) {
		return Response.json(
			{ error: t("api.auth.invalidToken") },
			{ status: 403 },
		);
	}
	// Each lookup costs a database query, and read routes are reachable with any Bearer header and no cookie.
	// A client that keeps presenting tokens that do not exist is refused for a while, across every path.
	const clientIp = getClientIp(request);
	const refused = await isCredentialClientBlockedAsync(UNKNOWN_TOKEN_SCOPE, clientIp);
	if (refused.blocked) return rateLimitResponse(Math.max(1000, refused.retryAfterMs));
	const authHeader = request.headers.get("authorization") ?? "";
	const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
	const verified = token ? await verifyApiToken(token) : null;
	if (!verified) {
		await recordUnknownCredentialAsync(UNKNOWN_TOKEN_SCOPE, clientIp);
		return Response.json(
			{ error: t("api.auth.invalidToken") },
			{ status: 401 },
		);
	}

	const ownerSession = await loadApiTokenOwnerSession(verified.userId, verified.teamId);
	if (!ownerSession) {
		return Response.json(
			{ error: t("api.auth.invalidToken") },
			{ status: 401 },
		);
	}
	// A read permission never authorises a state-changing request made with a token. Some handlers that write
	// (a ticket comment, cancelling one's own file job) accept a read permission for signed-in users, and the
	// proxy's "tokens are GET-only" rule only checks that a session cookie looks plausible, which a script can fake.
	// Without this, a leaked default read-only token could post and cancel as its owner.
	const readOnlyRequest = SAFE_TOKEN_METHODS.has(request.method.toUpperCase());
	const grantedRequired = [...new Set(requiredPermissions)].filter(
		(permission) =>
			!PLATFORM_ONLY_PERMISSIONS.has(permission) &&
			(readOnlyRequest || !permission.endsWith(":read")) &&
			tokenAllowsPermission(verified.scopes, permission) &&
			sessionHasPermission(ownerSession, permission),
	);
	if (grantedRequired.length === 0) {
		return Response.json(
			{ error: t("api.auth.invalidToken") },
			{ status: 403 },
		);
	}
	const grantedOptional = [...new Set(optionalPermissions)].filter(
		(permission) =>
			!PLATFORM_ONLY_PERMISSIONS.has(permission) &&
			tokenAllowsPermission(verified.scopes, permission) &&
			sessionHasPermission(ownerSession, permission),
	);
	const grantedPermissions = [...new Set([...grantedRequired, ...grantedOptional])];
	const session: SessionPayload = { ...ownerSession, roles: [], permissions: grantedPermissions };
	verifiedBearerIds.set(session, verified.tokenId);
	return {
		session,
		scopes: verified.scopes,
		tokenId: verified.tokenId,
	};
}

/**
 * Extract and verify a Bearer token from the Authorization header.
 * Returns null if no valid token found (caller should fall back to session auth).
 */
export async function verifyBearerToken(
	request: Request,
	requiredScope: Permission,
): Promise<BearerTokenResult | null> {
	if (!requiredScope) return null;
	const authenticated = await authenticateBearerForPermissions(
		request,
		[requiredScope],
	);
	if (!authenticated || authenticated instanceof Response) return null;
	return {
		userId: authenticated.session.userId,
		scopes: authenticated.scopes,
		tokenId: authenticated.tokenId,
		session: authenticated.session,
	};
}
