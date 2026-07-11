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
      errorMessage: "Failed to query upload session",
    },
    async ({ session }) => {
      if (!session) {
        throw new ForbiddenError("Not authenticated or session expired");
      }
      const view = await getMediaUploadSession(sessionId, session.userId);
      if (!view) {
        throw new NotFoundError(`Not foundUploadSession ${sessionId}`);
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
      errorMessage: "Failed to cancel upload session",
    },
    async ({ session }) => {
      if (!session) {
        throw new ForbiddenError("Not authenticated or session expired");
      }
      try {
        const view = await cancelMediaUploadSession(
          sessionId,
          session.userId,
        );
        await auditUserAction(
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
