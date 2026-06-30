/**
 * GET /api/servers/[id]/sftp/download?path=... — download a file from remote server
 *
 * Streams the file from SFTP directly to the HTTP response.
 */

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { downloadFile } from "@/lib/ssh/sftp-service";
import { downloadQuerySchema } from "@/lib/ssh/sftp-schema";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "server:ssh",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "SFTP download failed",
      querySchema: downloadQuerySchema,
    },
    async ({ query }) => {
      const { id } = await params;
      const { stream, size } = await downloadFile(id, query.path);

      // Extract filename for Content-Disposition
      const filename = query.path.split("/").pop() || "download";
      const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");

      const headers = new Headers({
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeFilename}"`,
        "Content-Length": String(size),
        "Cache-Control": "no-store",
      });

      return new Response(stream as unknown as ReadableStream, { status: 200, headers });
    },
  );
}
