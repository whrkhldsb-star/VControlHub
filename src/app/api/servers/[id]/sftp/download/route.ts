import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * GET /api/servers/[id]/sftp/download?path=... — download a file from remote server
 *
 * Streams the file from SFTP directly to the HTTP response.
 */

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { downloadFile } from "@/lib/ssh/sftp-service";
import { downloadQuerySchema } from "@/lib/ssh/sftp-schema";
import { assertSftpPathAccess } from "@/lib/ssh/sftp-access-control";
import { assertServerTeamAccess } from "@/lib/server/team-access";
import { auditUserAction } from "@/lib/audit/service";
import { buildContentDisposition } from "@/lib/http/content-disposition";
import { nodeStreamToWeb } from "@/lib/http/node-to-web-stream";

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
      errorMessage: apiCopy("apiCopy.sftp.download.failed.bec82f58"),
      querySchema: downloadQuerySchema,
    },
    async ({ query, session }) => {
      const { id } = await params;
      const teamAccess = await assertServerTeamAccess(session, id);
      if (!teamAccess.ok) return teamAccess.response;
			await assertSftpPathAccess({ session: session!, serverId: id, paths: [query.path] });
      const { stream, size } = await downloadFile(id, query.path);
      await auditUserAction(
        session!.userId,
        "sftp.download",
        { serverId: id, path: query.path, size },
        undefined,
        session?.currentTeamId,
      );

      // Preserve non-ASCII (e.g. Chinese) filenames via RFC 5987 instead of
      // replacing every non-ASCII char with "_" (which produced "____.pdf").
      const filename = query.path.split("/").pop() || "download";

      const headers = new Headers({
        "Content-Type": "application/octet-stream",
        "Content-Disposition": buildContentDisposition("attachment", filename),
        "Content-Length": String(size),
        "Cache-Control": "no-store",
      });

      // nodeStreamToWeb wires cancel() → stream.destroy() so a client abort
      // frees the SFTP session instead of leaking it until keepalive timeout.
      return new Response(nodeStreamToWeb(stream), { status: 200, headers });
    },
  );
}
