/**
 * POST /api/servers/[id]/sftp/rename — rename a file/directory on remote server
 */

import { NextResponse } from "next/server";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { renameEntry } from "@/lib/ssh/sftp-service";
import { renameSchema } from "@/lib/ssh/sftp-schema";

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
      errorMessage: "SFTP rename failed",
      bodySchema: renameSchema,
    },
    async ({ body }) => {
      const { id } = await params;
      await renameEntry(id, body.oldPath, body.newPath);
      return NextResponse.json({ success: true, oldPath: body.oldPath, newPath: body.newPath });
    },
  );
}
