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
import type { Permission } from "./rbac";
import type { SessionPayload } from "./session";
import { t } from "@/lib/i18n/translations";

export type BearerTokenResult = {
	userId: string;
	scopes: string[];
	tokenId: string;
};

export function hasBearerAuthorization(request: Request): boolean {
	return /^Bearer\s+/i.test(request.headers.get("authorization") ?? "");
}

export async function authenticateBearerForPermissions(
	request: Request,
	requiredPermissions: Permission[],
): Promise<
	| { session: SessionPayload; scopes: string[]; tokenId: string }
	| Response
	| null
> {
	if (!hasBearerAuthorization(request)) return null;
	const authHeader = request.headers.get("authorization") ?? "";
	const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
	const verified = token ? await verifyApiToken(token) : null;
	if (!verified) {
		return Response.json(
			{ error: t("api.auth.invalidToken") },
			{ status: 401 },
		);
	}

	const ownerSession = await loadApiTokenOwnerSession(verified.userId);
	if (!ownerSession) {
		return Response.json(
			{ error: t("api.auth.invalidToken") },
			{ status: 401 },
		);
	}
	const grantedPermissions = requiredPermissions.filter(
		(permission) =>
			tokenAllowsPermission(verified.scopes, permission) &&
			sessionHasPermission(ownerSession, permission),
	);
	if (grantedPermissions.length === 0) {
		return Response.json(
			{ error: t("api.auth.invalidToken") },
			{ status: 403 },
		);
	}
	return {
		session: { ...ownerSession, roles: [], permissions: grantedPermissions },
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
	};
}
