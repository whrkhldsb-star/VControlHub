import { NextResponse } from "next/server";

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
      errorMessage: "操作失败",
      bodySchema: voidBackupSchema,
    },
    async ({ body }) => {
      const { id } = await params;
      const backup = await voidBackupRecord({ id, reason: body.reason });
      return NextResponse.json({ backup });
    },
  );
}
