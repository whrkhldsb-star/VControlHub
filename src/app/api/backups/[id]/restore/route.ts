import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { restoreBackupSchema } from "@/lib/backup/schema";
import { prepareOfflineRestore } from "@/lib/backup/service";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { apiCatch } from "@/lib/http/api-error";
export const dynamic = "force-dynamic";

/**
 * Restore is offline only: this verifies the backup artifact (status and
 * SHA-256) and returns the runbook — stop services, safety snapshot, restore,
 * start services. Nothing is restored from inside the running platform; the
 * restore scripts refuse to run while it is online (see prepareOfflineRestore).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(
    request,
    {
      permission: "backup:restore",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: apiCopy("apiCopy.restore.failed.b8476cee"),
      bodySchema: restoreBackupSchema,
    },
    async ({ session, body }) => {
      const { id } = await params;
      try {
        const offlineRestore = await prepareOfflineRestore({ id, component: body.component, session });
        await auditUserAction(session.userId, "backup.restore_plan", { backupId: id, component: offlineRestore.component }, undefined, session.currentTeamId);
        return NextResponse.json({ offlineRestore });
      } catch (error) {
        return apiCatch(error);
      }
    },
  );
}
