import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { idQuerySchema, parseSearchParams } from "@/lib/http/parse-search-params";
import { deleteBackupSchedule } from "@/lib/backup/schedule-service";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "backup:create",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorStatus: 400,
      errorMessage: "删除备份计划失败",
      querySchema: idQuerySchema,
    },
    async ({ query }) => {
      const { id } = query;
      if (!id) return NextResponse.json({ error: "缺少计划 ID" }, { status: 400 });
      const result = await deleteBackupSchedule(id);
      return NextResponse.json(result);
    },
  );
}
