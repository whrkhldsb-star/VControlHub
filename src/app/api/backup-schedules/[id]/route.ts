import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { idQuerySchema } from "@/lib/http/parse-search-params";
import { deleteBackupSchedule } from "@/lib/backup/schedule-service";
import { auditUserAction } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "backup:create",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorStatus: 400,
      errorMessage: "Failed to delete backup schedule",
      querySchema: idQuerySchema,
    },
    async ({ query, session }) => {
      const { id } = query;
      if (!id) return NextResponse.json({ error: "Missing schedule ID" }, { status: 400 });
      const result = await deleteBackupSchedule(id);
      await auditUserAction(session?.userId ?? "", "backup-schedule.delete", { scheduleId: id });
      return NextResponse.json(result);
    },
  );
}
