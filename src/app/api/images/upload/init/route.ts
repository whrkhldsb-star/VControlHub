import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * TR-009 55c: POST /api/images/upload/init — open a chunked upload session.
 *
 * Body (zod-validated):
 *   { filename, mimeType, totalSize, chunkSize?, storageNodeId?, relativePath? }
 *
 * Returns:
 *   { session: MediaUploadSessionView } (status=201)
 *
 * Permission: image:write and storage:write, as the single-shot upload
 * (session-based; the chunk and session routes are shared with storage file
 * uploads and keep storage:write). API-token uploads of chunked
 * sessions are out of scope for now — existing /api/images/upload/route.ts
 * still covers the single-shot bearer-token path.
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { IMAGE_UPLOAD_LIMIT } from "@/lib/http/rate-limit-presets";
import { initMediaUploadSchema } from "@/lib/upload/schema";
import {
  initMediaUploadSession,
  MediaUploadError,
} from "@/lib/upload/service";
import { auditUserAction } from "@/lib/audit/service";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { ForbiddenError } from "@/lib/errors";
import { getServerLocale, t } from "@/lib/i18n/translations";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      // An image-bed upload, like the single-shot one: image:write, and
      // storage:write below. With storage:write alone, roles without the
      // image bed (operator, storage_manager) added images this way.
      permission: "image:write",
      rateLimit: IMAGE_UPLOAD_LIMIT,
      bodySchema: initMediaUploadSchema,
      errorStatus: 500,
      errorMessage: apiCopy("apiCopy.failed.to.initialize.upload.session.ede9e883"),
    },
    async ({ session, body }) => {
      if (!sessionHasPermission(session, "storage:write")) {
        throw new ForbiddenError(t("api.storage.writeDenied", await getServerLocale()));
      }
      try {
        const view = await initMediaUploadSession({
          userId: session.userId,
          filename: body.filename,
          mimeType: body.mimeType,
          totalSize: body.totalSize,
          session,
          ...(body.chunkSize !== undefined ? { chunkSize: body.chunkSize } : {}),
          ...(body.storageNodeId ? { storageNodeId: body.storageNodeId } : {}),
          ...(body.relativePath ? { relativePath: body.relativePath } : {}),
        });
        await auditUserAction(
          session.userId,
          "media.upload.init",
          {
            sessionId: view.id,
            filename: view.filename,
            mimeType: view.mimeType,
            totalSize: view.totalSize,
            chunkSize: view.chunkSize,
            totalChunks: view.totalChunks,
          },
          "INFO",
          session.currentTeamId,
        );
        return NextResponse.json({ session: view }, { status: 201 });
      } catch (err) {
        if (err instanceof MediaUploadError) {
          // Map service errors to 4xx via ValidationError so apiCatch wraps them.
          const { ValidationError } = await import("@/lib/errors");
          throw new ValidationError(err.message, { code: err.code });
        }
        throw err;
      }
    },
  );
}
