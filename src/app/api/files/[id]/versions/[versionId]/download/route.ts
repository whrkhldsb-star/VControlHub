/**
 * GET /api/files/[id]/versions/[versionId]/download — download a version blob
 */
import { NextResponse } from "next/server";
import { Readable } from "node:stream";

import { withApiRoute } from "@/lib/http/api-guard";
import { AuthError } from "@/lib/errors";
import { getFileVersionForDownload } from "@/lib/storage/file-versions";
import { guessContentType } from "@/lib/http/mime-types";

export const dynamic = "force-dynamic";

function contentDisposition(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "storage:read",
      errorMessage: "Failed to download file version",
    },
    async ({ session }) => {
      if (!session) throw new AuthError("Unauthorized");
      const { id, versionId } = await params;
      const { version, stream } = await getFileVersionForDownload({
        fileEntryId: id,
        versionId,
        session,
      });
      const webStream = Readable.toWeb(stream) as unknown as ReadableStream;
      const contentType =
        version.mimeType || guessContentType(version.name, null) || "application/octet-stream";
      return new NextResponse(webStream, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(version.sizeBytes),
          "Content-Disposition": contentDisposition(
            `v${version.versionNumber}-${version.name}`,
          ),
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      });
    },
  );
}
