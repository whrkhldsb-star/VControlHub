import { NextResponse } from "next/server";
import { z } from "zod";

import { voidBackupRecord } from "@/lib/backup/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

const voidBackupSchema = z.object({
  reason: z.string().trim().min(1, "作废原因不能为空").max(500, "作废原因最多 500 个字符"),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(request, { permission: "backup:create", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 500, errorMessage: "操作失败" }, async () => {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = voidBackupSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "作废参数无效" }, { status: 400 });
    const backup = await voidBackupRecord({ id, reason: parsed.data.reason });
    return NextResponse.json({ backup });
  });
}
