import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { listShareAccessLogs } from "@/lib/share-link/service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    { permission: "share:read", errorMessage: "Operation failed" },
    async ({ session }) => {
      const { id } = await params;
      const logs = await listShareAccessLogs(id, session!);
      return NextResponse.json({ logs });
    },
  );
}
