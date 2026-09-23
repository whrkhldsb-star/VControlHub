import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * POST /api/files/[id]/versions/[versionId]/restore — restore a historical version
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { auditUserAction } from "@/lib/audit/service";
import { restoreFileVersion } from "@/lib/storage/file-versions";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorStatus: 400,
      errorMessage: apiCopy("apiCopy.failed.to.restore.file.version.dd230a16"),
    },
    async ({ session }) => {
      const { id, versionId } = await params;
      const result = await restoreFileVersion({
        fileEntryId: id,
        versionId,
        session,
      });
      await auditUserAction(
        session.userId,
        "file.version.restore",
        {
          fileEntryId: id,
          versionId,
          restoredVersionNumber: result.restored.versionNumber,
          restorePointId: result.newRestorePoint?.id ?? null,
        },
        "WARNING",
        session.currentTeamId,
      );
      return NextResponse.json({
        success: true,
        restored: result.restored,
        restorePoint: result.newRestorePoint,
      });
    },
  );
}
