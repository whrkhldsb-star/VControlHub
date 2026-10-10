import { NextResponse } from "next/server";

import { assertPlatformAdmin } from "@/lib/auth/platform-admin-guard";
import { collectSystemHealthChecks } from "@/lib/system-health/service";
import { withApiRoute } from "@/lib/http/api-guard";

export const dynamic = "force-dynamic";

/** The platform self-check: platform administrators only. */
export async function GET(request: Request) {
  return withApiRoute(request, { permission: "health:read" }, async ({ session }) => {
    assertPlatformAdmin(session);
    return NextResponse.json(await collectSystemHealthChecks({ session }));
  });
}
