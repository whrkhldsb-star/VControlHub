import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { AuthError } from "@/lib/errors";
import { saveEditableFileBodySchema } from "@/lib/files/schema";
import {
  getLocalEditableFileDraft,
  saveLocalEditableFileDraft,
} from "@/lib/storage/service";
import { auditUserAction } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: "Failed to fetch file draft" },
    async ({ session }) => {
      if (!session) throw new AuthError("Unauthorized");
      const { id } = await params;
      const draft = await getLocalEditableFileDraft({ fileEntryId: id, session });
      return NextResponse.json({ draft });
    },
  );
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorStatus: 400,
      errorMessage: "Failed to save file",
      bodySchema: saveEditableFileBodySchema,
    },
    async ({ session, body }) => {
      if (!session) throw new AuthError("Unauthorized");
      const { id } = await params;

      const result = await saveLocalEditableFileDraft({
        fileEntryId: id,
        content: body.content,
        session,
        expectedUpdatedAt: body.expectedUpdatedAt,
        expectedLastModifiedMs: body.expectedLastModifiedMs,
      });
      await auditUserAction(session?.userId ?? "", "file.edit", { fileId: id }, undefined, session?.currentTeamId);
      return NextResponse.json({ success: true, file: result });
    },
  );
}
