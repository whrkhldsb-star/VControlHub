/**
 * GET  /api/files/[id]/versions          — list version history
 * POST /api/files/[id]/versions          — create manual snapshot
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { AuthError } from "@/lib/errors";
import { auditUserAction } from "@/lib/audit/service";
import {
  createManualFileVersion,
  listFileVersions,
} from "@/lib/storage/file-versions";

export const dynamic = "force-dynamic";

const createBodySchema = z.object({
  note: z.string().max(500).optional().nullable(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "storage:read",
      errorMessage: "Failed to list file versions",
    },
    async ({ session }) => {
      if (!session) throw new AuthError("Unauthorized");
      const { id } = await params;
      const versions = await listFileVersions({
        fileEntryId: id,
        session,
      });
      return NextResponse.json({ versions });
    },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: createBodySchema,
      errorStatus: 400,
      errorMessage: "Failed to create file version",
    },
    async ({ session, body }) => {
      if (!session) throw new AuthError("Unauthorized");
      const { id } = await params;
      const version = await createManualFileVersion({
        fileEntryId: id,
        session,
        note: body.note ?? null,
      });
      await auditUserAction(
        session.userId,
        "file.version.create",
        {
          fileEntryId: id,
          versionId: version.id,
          versionNumber: version.versionNumber,
          reason: version.reason,
        },
        "INFO",
      );
      return NextResponse.json({ version }, { status: 201 });
    },
  );
}
