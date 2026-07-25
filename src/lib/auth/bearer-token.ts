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

export type BearerTokenResult = {
	userId: string;
	scopes: string[];
	tokenId: string;
};

/**
 * Extract and verify a Bearer token from the Authorization header.
 * Returns null if no valid token found (caller should fall back to session auth).
 */
export async function verifyBearerToken(
	request: Request,
	requiredScope: string,
): Promise<BearerTokenResult | null> {
	const authHeader = request.headers.get("authorization");
	if (!authHeader?.startsWith("Bearer ")) return null;

	const token = authHeader.slice(7).trim();
	if (!token) return null;

	const result = await verifyApiToken(token);
	if (!result) return null;

	// Check scope: wildcard "read" covers all :read scopes; specific scopes override.
	// Do NOT honor an "admin" super-scope here — ALLOWED_API_TOKEN_SCOPES never
	// issues admin tokens, so treating it as wildcard would only reward a
	// hand-edited DB row / allowlist slip with unintended privilege.
	const hasScope = result.scopes.includes(requiredScope)
		|| (requiredScope.endsWith(":read") && result.scopes.includes("read"));

	if (!hasScope) return null;

	return {
		userId: result.userId,
		scopes: result.scopes,
		tokenId: result.tokenId,
	};
}
