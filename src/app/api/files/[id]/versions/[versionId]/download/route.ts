import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * GET /api/files/[id]/versions/[versionId]/download — download a version blob
 */
import { NextResponse } from "next/server";
import { Readable } from "node:stream";

import { withApiRoute } from "@/lib/http/api-guard";
import { getFileVersionForDownload } from "@/lib/storage/file-versions";
import { guessContentType } from "@/lib/http/mime-types";
import { buildContentDisposition } from "@/lib/http/content-disposition";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "storage:read",
      errorMessage: apiCopy("apiCopy.failed.to.download.file.version.0b96b819"),
    },
    async ({ session }) => {
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
          // The shared builder: the hand-written one left quotes and backslashes of the name in the header.
          "Content-Disposition": buildContentDisposition(
            "attachment",
            `v${version.versionNumber}-${version.name}`,
          ),
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      });
    },
  );
}
