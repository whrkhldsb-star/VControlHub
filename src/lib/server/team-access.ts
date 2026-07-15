/**
 * Team-scope guard for server-scoped resources.
 *
 * Servers are the root of a resource tree that includes SFTP routes,
 * VPS backup schedules/records, file-proxy entries, and uptime data.
 * All of these routes receive a `serverId` from the URL but previously
 * performed no team-scope verification — any user with the broad
 * operation permission (e.g. `server:ssh`) could access any team's
 * server by guessing its ID (IDOR).
 *
 * This module centralises the check: given a session and a serverId,
 * it verifies that the server's `teamId` is visible to the caller
 * according to the same rules as `teamWhere` / `teamAccessFilter`.
 *
 * Returns `null` when access is granted, or a `Response` (404) when
 * the server does not exist or is outside the caller's team scope.
 */

import { prisma } from "@/lib/db";
import type { SessionPayload } from "@/lib/auth/session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { NextResponse } from "next/server";

export type ServerTeamAccessResult =
  | { ok: true; server: { id: string; teamId: string | null } }
  | { ok: false; response: NextResponse };

/**
 * Verify that the caller's session can access the given server under
 * team-scope rules. Admins (`team:manage`) bypass the check. Non-admins
 * must either share the server's teamId or the server must be unassigned
 * (teamId = null, visible to everyone as a legacy/shared resource).
 *
 * Returns a discriminated union so callers can early-return the 404
 * response without an extra conditional:
 *
 * ```ts
 * const access = await assertServerTeamAccess(session, serverId);
 * if (!access.ok) return access.response;
 * // use access.server...
 * ```
 */
export async function assertServerTeamAccess(
  session: SessionPayload | null,
  serverId: string,
): Promise<ServerTeamAccessResult> {
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: { id: true, teamId: true },
  });

  if (!server) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Server not found" }, { status: 404 }),
    };
  }

  // Admins / team managers see all servers
  if (sessionHasPermission(session, "team:manage")) {
    return { ok: true, server };
  }

  // Unassigned servers are visible to everyone (legacy/shared)
  if (server.teamId === null) {
    return { ok: true, server };
  }

  // User's current team matches the server's team
  if (session.currentTeamId && server.teamId === session.currentTeamId) {
    return { ok: true, server };
  }

  // Does not belong to caller's team — return 404 (not 403) to avoid
  // leaking existence of resources outside the user's scope.
  return {
    ok: false,
    response: NextResponse.json({ error: "Server not found" }, { status: 404 }),
  };
}
