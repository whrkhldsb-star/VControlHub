/**
 * POST /api/servers/[id]/sftp/list — list directory contents on remote server
 */

import { NextResponse } from "next/server";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { listDirectory } from "@/lib/ssh/sftp-service";
import { listDirSchema } from "@/lib/ssh/sftp-schema";
import { assertSftpPathAccess } from "@/lib/ssh/sftp-access-control";
import { assertServerTeamAccess } from "@/lib/server/team-access";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "server:ssh",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "SFTP list failed",
      bodySchema: listDirSchema,
    },
    async ({ body, session }) => {
      const { id } = await params;
      const teamAccess = await assertServerTeamAccess(session, id);
      if (!teamAccess.ok) return teamAccess.response;
			await assertSftpPathAccess({ session: session!, serverId: id, paths: [body.path] });
      const entries = await listDirectory(id, body.path);
      return NextResponse.json({ path: body.path, entries });
    },
  );
}
