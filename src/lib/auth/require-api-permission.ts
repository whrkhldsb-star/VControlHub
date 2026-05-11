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
      return NextResponse.json({ error: "缺少权限" }, { status: 403 });
    }
    return { session };
  } catch {
    return NextResponse.json({ error: "未认证" }, { status: 401 });
  }
}
