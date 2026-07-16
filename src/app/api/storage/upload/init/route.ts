/**
 * POST /api/storage/upload/init — open a chunked upload session for ordinary
 * file-manager uploads (any MIME, requires storageNodeId + relativePath).
 *
 * Reuses MediaUploadSession + chunk endpoints; finalize via
 * POST /api/storage/upload/[id]/complete.
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { initStorageUploadSchema } from "@/lib/upload/schema";
import {
  initMediaUploadSession,
  MediaUploadError,
} from "@/lib/upload/service";
import { auditUserAction } from "@/lib/audit/service";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { normalizeStorageRelativePath } from "@/lib/storage/path-utils";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: initStorageUploadSchema,
      errorStatus: 500,
      errorMessage: "Failed to initialize storage upload session",
    },
    async ({ session, body }) => {
      if (!session) {
        throw new ForbiddenError("Not authenticated or session expired");
      }

      const normalized = normalizeStorageRelativePath(body.relativePath);
      if (normalized.ok !== true) {
        throw new ValidationError(normalized.reason);
      }
      const relativePath = normalized.path;

      const access = await assertStorageAccess({
        session,
        storageNodeId: body.storageNodeId,
        relativePath,
        operation: "write",
        writeBytes: body.totalSize,
      });
      if (!access.allowed) {
        throw new ForbiddenError(access.reason ?? "No permission to write to the storage path");
      }

      try {
        const view = await initMediaUploadSession({
          userId: session.userId,
          filename: body.filename,
          mimeType: body.mimeType || "application/octet-stream",
          totalSize: body.totalSize,
          ...(body.chunkSize !== undefined ? { chunkSize: body.chunkSize } : {}),
          storageNodeId: body.storageNodeId,
          relativePath,
        });
        await auditUserAction(
          session.userId,
          "storage.upload.init",
          {
            sessionId: view.id,
            filename: view.filename,
            mimeType: view.mimeType,
            totalSize: view.totalSize,
            storageNodeId: body.storageNodeId,
            relativePath,
          },
          "INFO",
        );
        return NextResponse.json({ session: view }, { status: 201 });
      } catch (err) {
        if (err instanceof MediaUploadError) {
          throw new ValidationError(err.message, { code: err.code });
        }
        throw err;
      }
    },
  );
}
