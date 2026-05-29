import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  favorite: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    if (!sessionHasPermission(session, "media:manage"))
      return NextResponse.json({ error: "缺少权限" }, { status: 403 });

    const { id } = await params;
    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json(
        { error: "输入校验失败", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );

    const existing = await prisma.mediaItem.findUnique({ where: { id } });
    if (!existing)
      return NextResponse.json({ error: "媒体不存在" }, { status: 404 });

    const data: Record<string, unknown> = {};
    if (parsed.data.favorite !== undefined) data.favorite = parsed.data.favorite;
    if (parsed.data.tags !== undefined) data.tags = parsed.data.tags;

    if (Object.keys(data).length === 0)
      return NextResponse.json({ item: existing });

    const updated = await prisma.mediaItem.update({ where: { id }, data });
    return NextResponse.json({ item: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "操作失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
