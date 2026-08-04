/**
 * WebDAV authentication — Bearer API token or Basic (password = API token).
 * Builds a SessionPayload from the token owner so storage grants/RBAC apply.
 */
import type { SessionPayload } from "@/lib/auth/session";
import type { Permission } from "@/lib/auth/rbac";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { loadApiTokenOwnerSession } from "@/lib/api-token/authorization";
import { verifyApiToken } from "@/lib/api-token/service";
import { AuthError } from "@/lib/errors";

export type WebDavAuth = {
  session: SessionPayload;
  tokenId: string;
  scopes: string[];
};

export function webDavTokenAllows(
  scopes: string[],
  needed: "read" | "write" | "delete",
): boolean {
  if (needed === "read") {
    return (
      scopes.includes("storage:read") ||
      scopes.includes("read") ||
      scopes.includes("storage:write") ||
      scopes.includes("storage:delete")
    );
  }
  if (needed === "write") {
    return scopes.includes("storage:write");
  }
  return scopes.includes("storage:delete");
}

export function webDavScopeForMethod(method: string): "read" | "write" | "delete" {
  const m = method.toUpperCase();
  if (m === "DELETE") return "delete";
  if (m === "PUT" || m === "MKCOL" || m === "MOVE" || m === "COPY" || m === "PROPPATCH") {
    return "write";
  }
  return "read";
}

async function authFromToken(
  token: string,
  needed: "read" | "write" | "delete",
): Promise<WebDavAuth | null> {
  const result = await verifyApiToken(token);
  if (!result) return null;
  if (!webDavTokenAllows(result.scopes, needed)) return null;
  const session = await loadApiTokenOwnerSession(result.userId);
  if (!session) return null;
  const requiredPermission = `storage:${needed}` as Permission;
  if (!sessionHasPermission(session, requiredPermission)) return null;
  return { session, tokenId: result.tokenId, scopes: result.scopes };
}

/**
 * Resolve WebDAV credentials from Authorization header.
 * Supports:
 *  - Bearer <api-token>
 *  - Basic base64(username:api-token)  — username is ignored for auth, token is password
 */
export async function authenticateWebDavRequest(
  request: Request,
  method: string,
): Promise<WebDavAuth> {
  const needed = webDavScopeForMethod(method);
  const header = request.headers.get("authorization") ?? "";

  if (header.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    const auth = token ? await authFromToken(token, needed) : null;
    if (!auth) throw new AuthError("Invalid or insufficient WebDAV token");
    return auth;
  }

  if (header.startsWith("Basic ")) {
    const encoded = header.slice(6).trim();
    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      const password = colon >= 0 ? decoded.slice(colon + 1) : decoded;
      const auth = password ? await authFromToken(password.trim(), needed) : null;
      if (!auth) throw new AuthError("Invalid or insufficient WebDAV credentials");
      return auth;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError("Invalid Basic authorization");
    }
  }

  throw new AuthError("WebDAV requires Bearer or Basic authentication");
}

export function webDavUnauthorizedResponse(realm = "VControlHub WebDAV"): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${realm}", charset="UTF-8"`,
      "DAV": "1, 2",
      "MS-Author-Via": "DAV",
    },
  });
}
