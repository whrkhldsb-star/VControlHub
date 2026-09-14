import { apiCopy } from "@/lib/i18n/api-copy";
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
      errorMessage: apiCopy("apiCopy.failed.to.query.upload.session.1a09e395"),
    },
    async ({ session }) => {
      if (!session) {
        throw new ForbiddenError(apiCopy("apiCopy.not.authenticated.or.session.expired.b1714d99"));
      }
      const view = await getMediaUploadSession(sessionId, session.userId);
      if (!view) {
        throw new NotFoundError(apiCopy("apiCopy.upload.session.not.found.84c8bec0", { v0: String(sessionId) }));
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
      errorMessage: apiCopy("apiCopy.failed.to.cancel.upload.session.5d0932f1"),
    },
    async ({ session }) => {
      if (!session) {
        throw new ForbiddenError(apiCopy("apiCopy.not.authenticated.or.session.expired.b1714d99"));
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
          session.currentTeamId,
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
