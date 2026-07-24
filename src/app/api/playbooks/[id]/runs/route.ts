import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { requirePlaybookId } from "@/lib/playbook/route-params";
import { listPlaybookRuns } from "@/lib/playbook/service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id?: string }> };

export async function GET(request: Request, { params }: Context) {
  return withApiRoute(
    request,
    { permission: "playbook:read", rateLimit: GENERAL_WRITE_LIMIT, errorMessage: "Failed to load playbook runs" },
    async ({ session }) => {
      const id = await requirePlaybookId(params);
      const runs = await listPlaybookRuns(id, session ?? undefined);
      return NextResponse.json({ runs });
    },
  );
}
