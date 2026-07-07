import { NextResponse } from "next/server";
import type { Permission } from "./rbac";
import { sessionHasPermission } from "./authorization";
import { requireSession } from "./require-session";
import type { SessionPayload } from "./session";

export async function requireApiPermission(
  permission: Permission,
): Promise<{ session: SessionPayload } | NextResponse> {
  try {
    const session = await requireSession();
    if (!sessionHasPermission(session, permission)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    return { session };
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
}
