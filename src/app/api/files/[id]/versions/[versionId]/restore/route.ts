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
      // Set only after the user confirmed restoring without a restore point
      // (the first attempt answered 409 because none could be saved).
      const allowWithoutRestorePoint = new URL(request.url).searchParams.get("allowWithoutRestorePoint") === "1";
      const result = await restoreFileVersion({
        fileEntryId: id,
        versionId,
        session,
        allowWithoutRestorePoint,
      });
      await auditUserAction(
        session.userId,
        "file.version.restore",
        {
          fileEntryId: id,
          versionId,
          restoredVersionNumber: result.restored.versionNumber,
          restorePointId: result.newRestorePoint?.id ?? null,
          ...(allowWithoutRestorePoint && !result.newRestorePoint ? { withoutRestorePoint: true } : {}),
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
