import { apiCopy, withApiCopyLocale } from "@/lib/i18n/api-copy";
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
import { enforceApiGuard, requestLocale } from "@/lib/http/api-guard";
import { CSRF_FAILURE_MESSAGE, requestPassesCsrfCheck } from "@/lib/auth/csrf-request";
import type { SessionPayload } from "@/lib/auth/session";
import { GENERAL_WRITE_LIMIT, withRateLimit, rateLimitResponse } from "@/lib/http/rate-limit-presets";
import { uploadFile, sanitizeRemotePath, sanitizeFileName } from "@/lib/ssh/sftp-service";
import { assertSftpPathAccess } from "@/lib/ssh/sftp-access-control";
import { assertServerTeamAccess } from "@/lib/server/team-access";
import { auditUserAction } from "@/lib/audit/service";
import { apiCatch, apiError } from "@/lib/http/api-error";
import { rejectOversizedFormBody } from "@/lib/http/form-body-limit";
import { isRequestHttps } from "@/lib/http/request-https";
import { withBaseSecurityHeaders } from "@/lib/http/security-headers";

export const dynamic = "force-dynamic";
// guardMode: manual
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100 MB
const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

/**
 * The proxy does not run on this route (see `config.matcher` in src/proxy.ts),
 * so what it does for every other state-changing request is done here: the
 * CSRF check in the handler, and the response headers on every answer.
 *
 * Nor does `withApiRoute` (it cannot take a multipart body), which is what
 * gives a request its language: without it this route's own refusals were
 * English and the service layer's Chinese, for every page.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const response = await withApiCopyLocale(await requestLocale(request), () => handleUpload(request, context));
  return withBaseSecurityHeaders(response, {
    https: isRequestHttps(request),
  });
}

async function handleUpload(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Rate-limit check (multipart can't use withApiRoute bodySchema)
  const rl = await withRateLimit(request, GENERAL_WRITE_LIMIT);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  // Auth + permission check
  const guard = await enforceApiGuard({ request, permission: "server:ssh" });
  if (guard instanceof Response) return guard;
  const session = guard as SessionPayload;

  // The proxy does not run on this route (its matcher leaves it out: Next
  // would buffer the upload and pass on only its first megabytes, which failed
  // every file over 10 MB), so the CSRF check the proxy makes for every other
  // state-changing request is made here.
  if (!requestPassesCsrfCheck(request)) {
    return apiError({ code: "FORBIDDEN", message: CSRF_FAILURE_MESSAGE, status: 403 });
  }

  const { id } = await params;
  const teamAccess = await assertServerTeamAccess(session, id, "fileWrite");
  if (!teamAccess.ok) return teamAccess.response;

  // formData() buffers the whole multipart body before the per-file size
  // check below, so refuse an oversized / length-undeclared body up front
  // (keeping this route's apiError envelope).
  const rejected = rejectOversizedFormBody(
    request,
    MAX_UPLOAD_SIZE + MAX_MULTIPART_OVERHEAD_BYTES,
    {
      tooLargeMessage: apiCopy("apiCopy.file.size.exceeds.mb.limit.da2978bf", { v0: String(MAX_UPLOAD_SIZE / 1024 / 1024) }),
      lengthRequiredMessage: apiCopy("apiCopy.content.length.required.for.uploads.085be099"),
      build: (status, message) =>
        apiError({
          code: status === 413 ? "REQUEST_ENTITY_TOO_LARGE" : "BAD_REQUEST",
          message,
          status,
        }),
    },
  );
  if (rejected) return rejected;

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
