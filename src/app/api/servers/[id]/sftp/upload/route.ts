import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * POST /api/servers/[id]/sftp/upload — upload a file to remote server
 *
 * Accepts multipart/form-data with:
 *   - file: the file to upload (File object)
 *   - path: the remote directory path (file will be placed at path/filename)
 *
 * File size is capped at 100 MB. The upload stream is piped directly to
 * the SFTP write stream for zero-buffer-copy efficiency.
 */

import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { enforceApiGuard } from "@/lib/http/api-guard";
import type { SessionPayload } from "@/lib/auth/session";
import { GENERAL_WRITE_LIMIT, withRateLimit, rateLimitResponse } from "@/lib/http/rate-limit-presets";
import { uploadFile, sanitizeRemotePath, sanitizeFileName } from "@/lib/ssh/sftp-service";
import { assertSftpPathAccess } from "@/lib/ssh/sftp-access-control";
import { assertServerTeamAccess } from "@/lib/server/team-access";
import { auditUserAction } from "@/lib/audit/service";
import { apiCatch, apiError } from "@/lib/http/api-error";
import { requestContentLengthExceeds, requestContentLengthMissing } from "@/lib/http/request-body";

export const dynamic = "force-dynamic";
// guardMode: manual
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100 MB
const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Rate-limit check (multipart can't use withApiRoute bodySchema)
  const rl = await withRateLimit(request, GENERAL_WRITE_LIMIT);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  // Auth + permission check
  const guard = await enforceApiGuard({ request, permission: "server:ssh" });
  if (guard instanceof Response) return guard;
  const session = guard as SessionPayload;

  const { id } = await params;
  const teamAccess = await assertServerTeamAccess(session, id);
  if (!teamAccess.ok) return teamAccess.response;

  if (
    requestContentLengthExceeds(
      request,
      MAX_UPLOAD_SIZE + MAX_MULTIPART_OVERHEAD_BYTES,
    )
  ) {
    return apiError({
      code: "REQUEST_ENTITY_TOO_LARGE",
      message: apiCopy("apiCopy.file.size.exceeds.mb.limit.da2978bf", { v0: String(MAX_UPLOAD_SIZE / 1024 / 1024) }),
      status: 413,
    });
  }
  // Without a declared length, request.formData() would buffer a chunked body
  // of unknown size into memory before any check — reject before parsing.
  if (requestContentLengthMissing(request)) {
    return apiError({
      code: "BAD_REQUEST",
      message: apiCopy("apiCopy.content.length.required.for.uploads.085be099"),
      status: 411,
    });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const remoteDir = formData.get("path");

    if (!file || !(file instanceof File)) {
      return apiError({
        code: "MISSING_FIELD",
        message: apiCopy("apiCopy.missing.file.field.in.form.data.28009398"),
        status: 400,
      });
    }
    if (!remoteDir || typeof remoteDir !== "string") {
      return apiError({
        code: "MISSING_FIELD",
        message: apiCopy("apiCopy.missing.path.field.in.form.data.9dbcad95"),
        status: 400,
      });
    }

    if (file.size > MAX_UPLOAD_SIZE) {
      return apiError({
        code: "REQUEST_ENTITY_TOO_LARGE",
        message: apiCopy("apiCopy.file.size.exceeds.mb.limit.da2978bf", { v0: String(MAX_UPLOAD_SIZE / 1024 / 1024) }),
        status: 413,
      });
    }

    const safeName = sanitizeFileName(file.name);
    const safeDir = sanitizeRemotePath(remoteDir);
    const fullPath = `${safeDir.replace(/\/$/, "")}/${safeName}`;
    await assertSftpPathAccess({ session, serverId: id, paths: [fullPath] });

    // Consume the Web File stream directly. Avoid arrayBuffer()/Buffer.from(),
    // which duplicated the complete upload in the Node.js heap.
    const stream = Readable.fromWeb(file.stream() as import("node:stream/web").ReadableStream);

    const bytesWritten = await uploadFile(id, fullPath, stream);
    await auditUserAction(
      session.userId,
      "sftp.upload",
      { serverId: id, path: fullPath, size: bytesWritten },
      undefined,
      session.currentTeamId,
    );

    return NextResponse.json({
      success: true,
      path: fullPath,
      size: bytesWritten,
    });
  } catch (error) {
    // `assertSftpPathAccess` throws ForbiddenError (path outside the SSH user's
    // home root) and NotFoundError (server missing/disabled). Collapsing those
    // into a blanket 500 told the client "our fault, retry" for what is in fact
    // a permanent authorization decision — and diverged from the five sibling
    // SFTP routes, which go through `withApiRoute` and therefore `apiCatch`.
    // This route parses multipart itself, so it must call `apiCatch` directly.
    return apiCatch(error, 500, "Upload failed");
  }
}
