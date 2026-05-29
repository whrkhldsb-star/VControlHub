import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { createAnnouncement, deleteAnnouncement, listActiveAnnouncements, listAnnouncements, updateAnnouncement } from "@/lib/announcement/service";

const announcementPostSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  type: z.enum(["info", "warning", "urgent"]).optional(),
  expiresAt: z.string().datetime().optional(),
  startsAt: z.string().optional(),
});

const announcementPatchSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  type: z.enum(["info", "warning", "urgent"]).optional(),
  pinned: z.boolean().optional(),
  published: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(request, { requireAuth: true }, async ({ session }) => {
    const manage = session ? sessionHasPermission(session, "announcement:manage") : false;
    return NextResponse.json({ announcements: manage ? await listAnnouncements() : await listActiveAnnouncements() });
  });
}

export async function POST(request: Request) {
  return withApiRoute(request, { permission: "announcement:manage", rateLimit: GENERAL_WRITE_LIMIT }, async ({ session }) => {
    const parsed = announcementPostSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "输入校验失败", details: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const data = parsed.data;
    return NextResponse.json(
      {
        announcement: await createAnnouncement({
          title: data.title,
          body: data.content,
          level: data.type,
          createdBy: session?.userId,
          startsAt: data.startsAt ? new Date(data.startsAt) : undefined,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        }),
      },
      { status: 201 },
    );
  });
}

export async function PATCH(request: Request) {
  return withApiRoute(request, { permission: "announcement:manage", rateLimit: GENERAL_WRITE_LIMIT }, async () => {
    const parsed = announcementPatchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "输入校验失败", details: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const { id, content, type, expiresAt, ...rest } = parsed.data;
    const result = await updateAnnouncement(id, {
      ...rest,
      body: content,
      level: type,
      expiresAt: expiresAt === undefined ? undefined : expiresAt === null ? null : new Date(expiresAt),
    });
    return NextResponse.json({ announcement: result });
  });
}

export async function DELETE(request: Request) {
  return withApiRoute(request, { permission: "announcement:manage", rateLimit: GENERAL_WRITE_LIMIT }, async () => {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "缺少公告 ID" }, { status: 400 });

    await deleteAnnouncement(id);
    return NextResponse.json({ success: true });
  });
}
