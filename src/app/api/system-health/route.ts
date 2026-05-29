import { NextResponse } from "next/server";

import { collectSystemHealthChecks } from "@/lib/system-health/service";
import { withApiRoute } from "@/lib/http/api-guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "health:read" }, async () => {
    return NextResponse.json(await collectSystemHealthChecks());
  });
}
