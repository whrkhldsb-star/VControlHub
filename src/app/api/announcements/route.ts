import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { createAnnouncement, listActiveAnnouncements, listAnnouncements } from "@/lib/announcement/service";

const announcementPostSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  type: z.enum(["info", "warning", "urgent"]).optional(),
  expiresAt: z.string().datetime().optional(),
  startsAt: z.string().optional(),
});

const announcementPatchSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  content: z.string().optional(),
  type: z.enum(["info", "warning", "urgent"]).optional(),
  active: z.boolean().optional(),
});

export const dynamic = "force-dynamic";
export async function GET(){ const session=await requireSession(); const manage=sessionHasPermission(session,"announcement:manage"); return NextResponse.json({ announcements: manage ? await listAnnouncements() : await listActiveAnnouncements() }); }
export async function POST(request:Request){ const session=await requireSession(); if(!sessionHasPermission(session,"announcement:manage")) return NextResponse.json({error:"缺少权限"},{status:403}); const body=await request.json(); const parsed=announcementPostSchema.safeParse(body); if(!parsed.success) return NextResponse.json({error:"输入校验失败",details:parsed.error.flatten().fieldErrors},{status:400}); const data=parsed.data; return NextResponse.json({ announcement: await createAnnouncement({ title: data.title, body: data.content, level: data.type, createdBy: session.userId, startsAt: data.startsAt ? new Date(data.startsAt) : undefined, expiresAt: data.expiresAt ? new Date(data.expiresAt) : null }) }, { status: 201 }); }
