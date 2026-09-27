import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { transferTeamOwnerSchema } from "@/lib/team/schema";
import { transferTeamOwnership } from "@/lib/team/service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    { requireAuth: true, rateLimit: GENERAL_WRITE_LIMIT, bodySchema: transferTeamOwnerSchema },
    async ({ session, body }) => {
      const { id } = await params;
      const owner = await transferTeamOwnership(id, body, session);
      return NextResponse.json({ success: true, owner });
    },
  );
}
