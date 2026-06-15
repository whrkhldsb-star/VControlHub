import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { AuthError } from "@/lib/errors";
import {
  getLocalEditableFileDraft,
  saveLocalEditableFileDraft,
} from "@/lib/storage/service";

export const dynamic = "force-dynamic";

const saveSchema = z.object({
  content: z.string().max(512 * 1024, "文件超过 512 KB，暂不支持在线编辑"),
  expectedUpdatedAt: z.string().datetime().optional().nullable(),
  expectedLastModifiedMs: z.number().finite().nonnegative().optional().nullable(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: "读取文件草稿失败" },
    async ({ session }) => {
      if (!session) throw new AuthError("未认证");
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
      errorMessage: "保存文件失败",
    },
    async ({ session }) => {
      if (!session) throw new AuthError("未认证");
      const { id } = await params;
      const body = await request.json().catch(() => ({}));
      const parsed = saveSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message ?? "文件内容无效" },
          { status: 400 },
        );
      }

      const result = await saveLocalEditableFileDraft({
        fileEntryId: id,
        content: parsed.data.content,
        session,
        expectedUpdatedAt: parsed.data.expectedUpdatedAt,
        expectedLastModifiedMs: parsed.data.expectedLastModifiedMs,
      });
      return NextResponse.json({ success: true, file: result });
    },
  );
}
