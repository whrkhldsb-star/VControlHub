/**
 * POST /api/storage/upload/[id]/complete — finalize a storage file
 * chunked upload session into LOCAL/SFTP storage + FileEntry index.
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { auditUserAction } from "@/lib/audit/service";
import { ForbiddenError } from "@/lib/errors";
import { completeStorageFileUpload } from "@/lib/storage/resumable-upload";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorStatus: 500,
      errorMessage: "Failed to complete storage upload session",
    },
    async ({ session }) => {
      if (!session) {
        throw new ForbiddenError("Not authenticated or session expired");
      }

      const result = await completeStorageFileUpload({
        sessionId,
        session,
      });

      await auditUserAction(
        session.userId,
        "storage.upload.complete",
        {
          sessionId,
          storageNodeId: result.storageNodeId,
          relativePath: result.relativePath,
          size: result.size,
        },
        "INFO",
      );

      return NextResponse.json({
        session: result.session,
        relativePath: result.relativePath,
        size: result.size,
        storageNodeId: result.storageNodeId,
      });
    },
  );
}
