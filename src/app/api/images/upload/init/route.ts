/**
 * TR-009 55c: POST /api/images/upload/init — open a chunked upload session.
 *
 * Body (zod-validated):
 *   { filename, mimeType, totalSize, chunkSize?, storageNodeId?, relativePath? }
 *
 * Returns:
 *   { session: MediaUploadSessionView } (status=201)
 *
 * Permission: storage:write (session-based). API-token uploads of chunked
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
import { ForbiddenError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: IMAGE_UPLOAD_LIMIT,
      bodySchema: initMediaUploadSchema,
      errorStatus: 500,
      errorMessage: "初始化上传会话失败",
    },
    async ({ session, body }) => {
      if (!session) {
        throw new ForbiddenError("未登录或会话已过期");
      }
      try {
        const view = await initMediaUploadSession({
          userId: session.userId,
          filename: body.filename,
          mimeType: body.mimeType,
          totalSize: body.totalSize,
          ...(body.chunkSize !== undefined ? { chunkSize: body.chunkSize } : {}),
          ...(body.storageNodeId ? { storageNodeId: body.storageNodeId } : {}),
          ...(body.relativePath ? { relativePath: body.relativePath } : {}),
        });
        auditUserAction(
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
