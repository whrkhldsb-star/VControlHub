import { withServerLifecycleLock } from "@/lib/server/lifecycle-lock";
import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * DELETE /api/servers/[id]/sftp/delete?path=... — delete a file on remote server
 */

import { NextResponse } from "next/server";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { deleteFile } from "@/lib/ssh/sftp-service";
import { deleteQuerySchema } from "@/lib/ssh/sftp-schema";
import { loadEnabledServerForSftp } from "@/lib/ssh/server-target";
import { assertSftpPathAccess } from "@/lib/ssh/sftp-access-control";
import { auditUserAction } from "@/lib/audit/service";
import { assertServerTeamAccess } from "@/lib/server/team-access";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "server:ssh",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: apiCopy("apiCopy.sftp.delete.failed.7fbec7a6"),
      querySchema: deleteQuerySchema,
    },
    async ({ query, session }) => {
      const { id } = await params;
      return withServerLifecycleLock(id, async () => {
        const teamAccess = await assertServerTeamAccess(session, id, "fileDelete");
        if (!teamAccess.ok) return teamAccess.response;
        const target = await loadEnabledServerForSftp(id, teamAccess.server.teamId, teamAccess.server, request.signal);
        await assertSftpPathAccess({ session, serverId: id, paths: [query.path], target, signal: request.signal });
        await deleteFile(id, query.path, target.ssh);
        await auditUserAction(session.userId, "sftp.delete", { serverId: id, path: query.path }, undefined, session.currentTeamId);
        return NextResponse.json({ success: true, path: query.path });
      });
    },
  );
}
