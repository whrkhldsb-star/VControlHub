import { NextResponse } from "next/server";

import { runPlaybook } from "@/lib/playbook/service";
import { idQuerySchema } from "@/lib/playbook/schema";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/playbooks/[id]/dry-run
 *
 * Walks the chain without persisting side effects. The returned
 * PlaybookRun record is persisted with `dryRun: true` so the UI can
 * show "this is what would happen" alongside the real run history.
 */
export async function POST(request: Request) {
  return withApiRoute(
    request,
    { permission: "playbook:run", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 400, errorMessage: "dry-run 失败" },
    async ({ session }) => {
      const { id } = parseSearchParams(request, idQuerySchema);
      if (!id) throw new ValidationError("缺少 playbook id");
      const run = await runPlaybook({
        playbookId: id,
        dryRun: true,
        triggerContext: { source: "dry-run", at: new Date().toISOString() },
        createdById: session?.userId ?? undefined,
      });
      return NextResponse.json({ run });
    },
  );
}
