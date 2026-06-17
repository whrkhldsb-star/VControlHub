/**
 * TR-009 55c: GET / DELETE /api/images/upload/[id] — query or cancel a
 * chunked upload session.
 *
 * GET   → { session: MediaUploadSessionView } — used by client to resume
 *         after disconnect.
 * DELETE → { session: MediaUploadSessionView } — cancels the session and
 *         cleans up any chunks on disk.
 *
 * Permission: storage:write (session-based, owner-scoped via service).
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { IMAGE_UPLOAD_LIMIT } from "@/lib/http/rate-limit-presets";
import {
  cancelMediaUploadSession,
  getMediaUploadSession,
  MediaUploadError,
} from "@/lib/upload/service";
import { auditUserAction } from "@/lib/audit/service";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: IMAGE_UPLOAD_LIMIT,
      errorStatus: 500,
      errorMessage: "查询上传会话失败",
    },
    async ({ session }) => {
      if (!session) {
        throw new ForbiddenError("未登录或会话已过期");
      }
      const view = await getMediaUploadSession(sessionId, session.userId);
      if (!view) {
        throw new NotFoundError(`未找到上传会话 ${sessionId}`);
      }
      return NextResponse.json({ session: view });
    },
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: IMAGE_UPLOAD_LIMIT,
      errorStatus: 500,
      errorMessage: "取消上传会话失败",
    },
    async ({ session }) => {
      if (!session) {
        throw new ForbiddenError("未登录或会话已过期");
      }
      try {
        const view = await cancelMediaUploadSession(
          sessionId,
          session.userId,
        );
        auditUserAction(
          session.userId,
          "media.upload.cancel",
          { sessionId, status: view.status },
          "INFO",
        );
        return NextResponse.json({ session: view });
      } catch (err) {
        if (err instanceof MediaUploadError) {
          if (err.code === "session_not_found") {
            throw new NotFoundError(err.message);
          }
          throw new ValidationError(err.message, { code: err.code });
        }
        throw err;
      }
    },
  );
}
