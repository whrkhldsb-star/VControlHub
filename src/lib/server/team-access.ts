import { apiCopy } from "@/lib/i18n/api-copy";
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
import { isGlobalTeamManager, seesAllCustomers } from "@/lib/auth/team-scope";
import { NextResponse } from "next/server";
import { SERVER_ACCESS_FIELDS, type ServerAccessCapability } from "./resource-access";

export type ServerTeamAccessResult =
  | { ok: true; server: { id: string; teamId: string | null } }
  | { ok: false; response: NextResponse };

/**
 * Verify that the caller's session can access the given server under
 * team-scope rules. Platform administrators may cross customers; customer
 * accounts stay inside their customer and are narrowed by per-server rows.
 * Unassigned legacy servers remain restricted to platform administrators.
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
  capability: ServerAccessCapability = "read",
): Promise<ServerTeamAccessResult> {
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: apiCopy("apiCopy.unauthorized.d089c8a9") }, { status: 401 }),
    };
  }

  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: { id: true, teamId: true },
  });

  if (!server) {
    return {
      ok: false,
      response: NextResponse.json({ error: apiCopy("apiCopy.server.not.found.d7783f94") }, { status: 404 }),
    };
  }

  // Administrators viewing all customers reach every server; with a customer
  // selected they see that customer, like every list does.
  if (seesAllCustomers(session)) {
    return { ok: true, server };
  }

  if (session.currentTeamId && server.teamId === session.currentTeamId) {
    if (isGlobalTeamManager(session)) return { ok: true, server };
    // Per-user server rows narrow customer accounts to specific servers.
    const override = await prisma.userServerAccess.findUnique({
      where: { userId_serverId: { userId: session.userId, serverId } },
      select: { [SERVER_ACCESS_FIELDS[capability]]: true },
    });
    if (!override || override[SERVER_ACCESS_FIELDS[capability]] === true) {
      return { ok: true, server };
    }
  }

  // Does not belong to caller's team — return 404 (not 403) to avoid
  // leaking existence of resources outside the user's scope.
  return {
    ok: false,
    response: NextResponse.json({ error: apiCopy("apiCopy.server.not.found.d7783f94") }, { status: 404 }),
  };
}
