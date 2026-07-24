import { NextResponse } from "next/server";

import { runPlaybook } from "@/lib/playbook/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { requirePlaybookId } from "@/lib/playbook/route-params";

export const dynamic = "force-dynamic";

type PlaybookRouteContext = { params: Promise<{ id?: string }> };

/**
 * POST /api/playbooks/[id]/dry-run
 *
 * Durable enqueue of a dry-run. Side effects are skipped by the worker;
 * returns 202 with a queued PlaybookRun immediately.
 */
export async function POST(request: Request, { params }: PlaybookRouteContext) {
  return withApiRoute(
    request,
    { permission: "playbook:run", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 400, errorMessage: "dry-run Failed" },
    async ({ session }) => {
      const id = await requirePlaybookId(params);
      const run = await runPlaybook({
        playbookId: id,
        dryRun: true,
        triggerContext: { source: "dry-run", at: new Date().toISOString() },
        createdById: session?.userId ?? undefined,
        session: session ?? undefined,
      });
      return NextResponse.json({ run }, { status: 202 });
    },
  );
}
