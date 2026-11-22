import { withServerLifecycleLock } from "@/lib/server/lifecycle-lock";
import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * POST /api/servers/[id]/sftp/list — list directory contents on remote server
 */

import { NextResponse } from "next/server";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT } from "@/lib/http/rate-limit-presets";
import { listDirectory } from "@/lib/ssh/sftp-service";
import { listDirSchema } from "@/lib/ssh/sftp-schema";
import { assertSftpPathAccess } from "@/lib/ssh/sftp-access-control";
import { assertServerTeamAccess } from "@/lib/server/team-access";
import { loadEnabledServerForSftp } from "@/lib/ssh/server-target";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "server:ssh",
      // Directory listing is a read path; do not share the write bucket with mkdir/upload.
      rateLimit: GENERAL_READ_LIMIT,
      errorMessage: apiCopy("apiCopy.sftp.list.failed.e07eb727"),
      bodySchema: listDirSchema,
    },
    async ({ body, session }) => {
      const { id } = await params;
      return withServerLifecycleLock(id, async () => {
        const teamAccess = await assertServerTeamAccess(session, id, "fileRead");
        if (!teamAccess.ok) return teamAccess.response;
        const target = await loadEnabledServerForSftp(id, teamAccess.server.teamId, teamAccess.server, request.signal);
        const directory = body.path ?? target.rootPath;
        const root = await assertSftpPathAccess({ session, serverId: id, paths: [directory], target, signal: request.signal });
        const listing = await listDirectory(id, directory, { ssh: target.ssh, root, signal: request.signal });
        return NextResponse.json({ path: directory, ...listing });
      });
    },
  );
}
