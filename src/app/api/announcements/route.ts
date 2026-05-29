import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { createAnnouncement, listActiveAnnouncements, listAnnouncements, updateAnnouncement, deleteAnnouncement } from "@/lib/announcement/service";
import { withRateLimit, rateLimitResponse, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

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

export async function GET(_request: Request) {
  try {
    const session = await requireSession();
    const manage = sessionHasPermission(session, "announcement:manage");
    return NextResponse.json({ announcements: manage ? await listAnnouncements() : await listActiveAnnouncements() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
  try {
    const session = await requireSession();
    if (!sessionHasPermission(session, "announcement:manage")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
    const body = await request.json();
    const parsed = announcementPostSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "输入校验失败", details: parsed.error.flatten().fieldErrors }, { status: 400 });
    const data = parsed.data;
    return NextResponse.json({ announcement: await createAnnouncement({ title: data.title, body: data.content, level: data.type, createdBy: session.userId, startsAt: data.startsAt ? new Date(data.startsAt) : undefined, expiresAt: data.expiresAt ? new Date(data.expiresAt) : null }) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
  try {
    const session = await requireSession();
    if (!sessionHasPermission(session, "announcement:manage")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
    const body = await request.json();
    const parsed = announcementPatchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "输入校验失败", details: parsed.error.flatten().fieldErrors }, { status: 400 });
    const { id, content, type, expiresAt, ...rest } = parsed.data;
    const result = await updateAnnouncement(id, {
      ...rest,
      body: content,
      level: type,
      expiresAt: expiresAt === undefined ? undefined : expiresAt === null ? null : new Date(expiresAt),
    });
    return NextResponse.json({ announcement: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
  try {
    const session = await requireSession();
    if (!sessionHasPermission(session, "announcement:manage")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "缺少公告 ID" }, { status: 400 });
    await deleteAnnouncement(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
