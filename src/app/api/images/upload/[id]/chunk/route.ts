/**
 * TR-009 55c: PUT /api/images/upload/[id]/chunk — append a single chunk.
 *
 * URL params: id = MediaUploadSession.id
 * Query: ?index=N&size=N (zod-validated via appendMediaChunkSchema)
 * Body: raw bytes (ArrayBuffer). NOT JSON.
 *
 * Returns: { session: MediaUploadSessionView }
 * Permission: storage:write (session-based, owner-scoped via service).
 *
 * Rate limit: GENERAL_WRITE_LIMIT (30 req/min) — chunks are higher
 * frequency than init/complete, but we still want throttling.
 *
 * NOTE: withApiRoute's bodySchema option only handles JSON. We read
 * `request.arrayBuffer()` directly after the query schema validates
 * index+size.
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { appendMediaChunkSchema } from "@/lib/upload/schema";
import {
  appendMediaUploadChunk,
  MediaUploadError,
} from "@/lib/upload/service";
import { ForbiddenError, ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      querySchema: appendMediaChunkSchema,
      errorStatus: 500,
      errorMessage: "Failed to upload chunk",
    },
    async ({ session, query }) => {
      if (!session) {
        throw new ForbiddenError("Not authenticated or session expired");
      }
      let buffer: Buffer;
      try {
        const ab = await request.arrayBuffer();
        buffer = Buffer.from(ab);
      } catch (err) {
        throw new ValidationError("Failed to read chunk content", {
          reason: err instanceof Error ? err.message : String(err),
        });
      }
      try {
        const view = await appendMediaUploadChunk({
          sessionId,
          userId: session.userId,
          index: query.index,
          size: query.size,
          buffer,
        });
        return NextResponse.json({ session: view });
      } catch (err) {
        if (err instanceof MediaUploadError) {
          throw new ValidationError(err.message, { code: err.code });
        }
        throw err;
      }
    },
  );
}
