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

export const dynamic = "force-dynamic";
// guardMode: manual
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100 MB

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

  const { id } = await params;
  const teamAccess = await assertServerTeamAccess(guard as SessionPayload, id);
  if (!teamAccess.ok) return teamAccess.response;

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const remoteDir = formData.get("path");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing 'file' field in form data" },
        { status: 400 },
      );
    }
    if (!remoteDir || typeof remoteDir !== "string") {
      return NextResponse.json(
        { error: "Missing 'path' field in form data" },
        { status: 400 },
      );
    }

    if (file.size > MAX_UPLOAD_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds ${MAX_UPLOAD_SIZE / 1024 / 1024}MB limit` },
        { status: 413 },
      );
    }

    const safeName = sanitizeFileName(file.name);
    const safeDir = sanitizeRemotePath(remoteDir);
    const fullPath = `${safeDir.replace(/\/$/, "")}/${safeName}`;
		if (!guard) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
		await assertSftpPathAccess({ session: guard, serverId: id, paths: [fullPath] });

    // Consume the Web File stream directly. Avoid arrayBuffer()/Buffer.from(),
    // which duplicated the complete upload in the Node.js heap.
    const stream = Readable.fromWeb(file.stream() as import("node:stream/web").ReadableStream);

    const bytesWritten = await uploadFile(id, fullPath, stream);

    return NextResponse.json({
      success: true,
      path: fullPath,
      size: bytesWritten,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
