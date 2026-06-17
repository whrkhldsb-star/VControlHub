import { NextResponse } from "next/server";

import { runPlaybook } from "@/lib/playbook/service";
import { idQuerySchema } from "@/lib/playbook/schema";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/playbooks/[id]/run
 *
 * Real run. Triggers the chain executor; side effects (run_command,
 * send_notification) DO happen. Caller must have `playbook:run` and
 * the playbook must be `enabled=true` (service enforces the latter).
 */
export async function POST(request: Request) {
  return withApiRoute(
    request,
    { permission: "playbook:run", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 400, errorMessage: "运行失败" },
    async ({ session }) => {
      const { id } = parseSearchParams(request, idQuerySchema);
      if (!id) throw new ValidationError("缺少 playbook id");
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
