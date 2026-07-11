/**
 * POST /api/servers/[id]/sftp/mkdir — create a directory on remote server
 */

import { NextResponse } from "next/server";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { makeDirectory } from "@/lib/ssh/sftp-service";
import { mkdirSchema } from "@/lib/ssh/sftp-schema";
import { assertSftpPathAccess } from "@/lib/ssh/sftp-access-control";
import { auditUserAction } from "@/lib/audit/service";

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
      errorMessage: "SFTP mkdir failed",
      bodySchema: mkdirSchema,
    },
    async ({ body, session }) => {
      const { id } = await params;
			await assertSftpPathAccess({ session: session!, serverId: id, paths: [body.path] });
      await makeDirectory(id, body.path);
      await auditUserAction(session!.userId, "sftp.mkdir", { serverId: id, path: body.path });
      return NextResponse.json({ success: true, path: body.path });
    },
  );
}
