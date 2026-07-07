import { NextResponse } from "next/server";

import { runPlaybook } from "@/lib/playbook/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type PlaybookRouteContext = { params: Promise<{ id?: string }> };

async function requirePlaybookId(params: PlaybookRouteContext["params"]): Promise<string> {
  const { id } = await params;
  const normalized = id?.trim();
  if (!normalized) throw new ValidationError("Missing playbook id");
  return normalized;
}

/**
 * POST /api/playbooks/[id]/run
 *
 * Real run. Triggers the chain executor; side effects (run_command,
 * send_notification) DO happen. Caller must have `playbook:run` and
 * the playbook must be `enabled=true` (service enforces the latter).
 */
export async function POST(request: Request, { params }: PlaybookRouteContext) {
  return withApiRoute(
    request,
    { permission: "playbook:run", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 400, errorMessage: "RunFailed" },
    async ({ session }) => {
      const id = await requirePlaybookId(params);
      const run = await runPlaybook({
        playbookId: id,
        dryRun: false,
        triggerContext: { source: "manual", at: new Date().toISOString(), userId: session?.userId ?? null },
        createdById: session?.userId ?? undefined,
      });
      return NextResponse.json({ run });
    },
  );
}
