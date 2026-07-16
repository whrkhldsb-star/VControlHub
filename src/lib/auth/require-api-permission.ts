import { NextResponse } from "next/server";
import type { Permission } from "./rbac";
import { sessionHasPermission } from "./authorization";
import { isSessionPayload, requireApiSession } from "./api-session";
import type { SessionPayload } from "./session";

/**
 * Require an authenticated API session that holds `permission`.
 *
 * Uses {@link requireApiSession} (JSON 401/403) — never the page
 * {@link requireSession} redirect helper — so API clients always get
 * machine-readable auth failures, including MUST_CHANGE_PASSWORD.
 */
export async function requireApiPermission(
  permission: Permission,
): Promise<{ session: SessionPayload } | NextResponse> {
  const sessionOrResponse = await requireApiSession();
  if (!isSessionPayload(sessionOrResponse)) {
    return sessionOrResponse;
  }
  if (!sessionHasPermission(sessionOrResponse, permission)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }
  return { session: sessionOrResponse };
}
