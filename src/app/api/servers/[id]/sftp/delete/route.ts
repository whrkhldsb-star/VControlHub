/**
 * DELETE /api/servers/[id]/sftp/delete?path=... — delete a file on remote server
 */

import { NextResponse } from "next/server";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { deleteFile } from "@/lib/ssh/sftp-service";
import { deleteQuerySchema } from "@/lib/ssh/sftp-schema";
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
      errorMessage: "SFTP delete failed",
      querySchema: deleteQuerySchema,
    },
    async ({ query, session }) => {
      const { id } = await params;
      const teamAccess = await assertServerTeamAccess(session, id);
      if (!teamAccess.ok) return teamAccess.response;
			await assertSftpPathAccess({ session: session!, serverId: id, paths: [query.path] });
      await deleteFile(id, query.path);
      await auditUserAction(session!.userId, "sftp.delete", { serverId: id, path: query.path });
      return NextResponse.json({ success: true, path: query.path });
    },
  );
}
