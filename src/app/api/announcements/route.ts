import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { createAnnouncement, listActiveAnnouncements, listAnnouncements } from "@/lib/announcement/service";
export const dynamic = "force-dynamic";
export async function GET(){ const session=await requireSession(); const manage=sessionHasPermission(session,"announcement:manage"); return NextResponse.json({ announcements: manage ? await listAnnouncements() : await listActiveAnnouncements() }); }
export async function POST(request:Request){ const session=await requireSession(); if(!sessionHasPermission(session,"announcement:manage")) return NextResponse.json({error:"缺少权限"},{status:403}); const body=await request.json(); return NextResponse.json({ announcement: await createAnnouncement({ ...body, createdBy: session.userId, startsAt: body.startsAt ? new Date(body.startsAt) : undefined, expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }) }, { status: 201 }); }
