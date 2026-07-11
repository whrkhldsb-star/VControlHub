import { NextResponse } from "next/server";

import { runPlaybook } from "@/lib/playbook/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { ValidationError } from "@/lib/errors";
import { auditUserAction } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

type PlaybookRouteContext = { params: Promise<{ id?: string }> };

async function requirePlaybookId(params: PlaybookRouteContext["params"]): Promise<string> {
  const { id } = await params;
  const normalized = id?.trim();
  if (!normalized) throw new ValidationError("Missing playbook id");
  return normalized;
}

/**
 * POST /api/playbooks/[id]/dry-run
 *
 * Walks the chain without persisting side effects. The returned
 * PlaybookRun record is persisted with `dryRun: true` so the UI can
 * show "this is what would happen" alongside the real run history.
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
      });
      await auditUserAction(session?.userId ?? "", "playbook.dry-run", { playbookId: id });
      return NextResponse.json({ run });
    },
  );
}
