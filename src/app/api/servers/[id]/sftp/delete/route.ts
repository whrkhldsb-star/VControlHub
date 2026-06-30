/**
 * DELETE /api/servers/[id]/sftp/delete?path=... — delete a file on remote server
 */

import { NextResponse } from "next/server";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { deleteFile } from "@/lib/ssh/sftp-service";
import { deleteQuerySchema } from "@/lib/ssh/sftp-schema";

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
    async ({ query }) => {
      const { id } = await params;
      await deleteFile(id, query.path);
      return NextResponse.json({ success: true, path: query.path });
    },
  );
}
