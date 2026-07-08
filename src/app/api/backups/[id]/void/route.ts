import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { voidBackupSchema } from "@/lib/backup/schema";
import { voidBackupRecord } from "@/lib/backup/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(
    request,
    {
      permission: "backup:create",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorStatus: 500,
      errorMessage: "Operation failed",
      bodySchema: voidBackupSchema,
    },
    async ({ session, body }) => {
      const { id } = await params;
      const backup = await voidBackupRecord({ id, reason: body.reason });
      auditUserAction(session!.userId, "backup.void", { backupId: id, reason: body.reason });
      return NextResponse.json({ backup });
    },
  );
}
