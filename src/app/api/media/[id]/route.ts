import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";

import { NotFoundError } from "@/lib/errors";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  favorite: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    { permission: "media:manage", errorMessage: "操作失败" },
    async () => {
      const { id } = await params;
      const body = await request.json().catch(() => null);
      const parsed = patchSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "输入校验失败",
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 400 },
        );
      }

      const existing = await prisma.mediaItem.findUnique({ where: { id } });
      if (!existing)
        throw new NotFoundError("媒体不存在");

      const data: Record<string, unknown> = {};
      if (parsed.data.favorite !== undefined)
        data.favorite = parsed.data.favorite;
      if (parsed.data.tags !== undefined) data.tags = parsed.data.tags;

      if (Object.keys(data).length === 0)
        return NextResponse.json({ item: existing });

      const updated = await prisma.mediaItem.update({ where: { id }, data });
      return NextResponse.json({ item: updated });
    },
  );
}
