import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";

import { runPlaybook } from "@/lib/playbook/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { requirePlaybookId } from "@/lib/playbook/route-params";

export const dynamic = "force-dynamic";

type PlaybookRouteContext = { params: Promise<{ id?: string }> };

/**
 * POST /api/playbooks/[id]/run
 *
 * Durable enqueue. Creates PlaybookRun + playbook.run job and returns 202.
 * Side effects run in the playbook worker (not the request lifecycle).
 */
export async function POST(request: Request, { params }: PlaybookRouteContext) {
  return withApiRoute(
    request,
    { permission: "playbook:run", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 400, errorMessage: apiCopy("apiCopy.failed.to.run.f9aa3903") },
    async ({ session }) => {
      const id = await requirePlaybookId(params);
      const run = await runPlaybook({
        playbookId: id,
        dryRun: false,
        triggerContext: { source: "manual", at: new Date().toISOString(), userId: session.userId },
        createdById: session.userId,
        session,
      });
      return NextResponse.json({ run }, { status: 202 });
    },
  );
}
