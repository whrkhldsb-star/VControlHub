/**
 * WebDAV authentication — Bearer API token or Basic (password = API token).
 * Builds a SessionPayload from the token owner so storage grants/RBAC apply.
 */
import { prisma } from "@/lib/db";
import type { SessionPayload } from "@/lib/auth/session";
import type { RoleKey } from "@/lib/auth/rbac";
import { verifyApiToken } from "@/lib/api-token/service";
import { AuthError } from "@/lib/errors";

export type WebDavAuth = {
  session: SessionPayload;
  tokenId: string;
  scopes: string[];
};

function tokenAllows(scopes: string[], needed: "read" | "write" | "delete"): boolean {
  if (scopes.includes("admin")) return true;
  if (needed === "read") {
    return (
      scopes.includes("storage:read") ||
      scopes.includes("read") ||
      scopes.includes("storage:write") ||
      scopes.includes("storage:delete")
    );
  }
  if (needed === "write") {
    return scopes.includes("storage:write") || scopes.includes("storage:delete");
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

async function sessionFromUserId(userId: string): Promise<SessionPayload | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      status: true,
      mustChangePassword: true,
      currentTeamId: true,
      roles: { select: { role: { select: { key: true } } } },
    },
  });
  if (!user || user.status === "DISABLED") return null;
  const roles = user.roles
    .map((r) => r.role.key as string)
    .filter((key): key is RoleKey =>
      key === "admin" || key === "operator" || key === "viewer" || key === "storage_manager",
    );
  return {
    userId: user.id,
    username: user.username,
    roles,
    mustChangePassword: user.mustChangePassword,
    currentTeamId: user.currentTeamId ?? null,
  };
}

async function authFromToken(
  token: string,
  needed: "read" | "write" | "delete",
): Promise<WebDavAuth | null> {
  const result = await verifyApiToken(token);
  if (!result) return null;
  if (!tokenAllows(result.scopes, needed)) return null;
  const session = await sessionFromUserId(result.userId);
  if (!session) return null;
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
