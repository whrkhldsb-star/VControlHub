import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { createSnippet, listSnippets } from "@/lib/snippet/service";
export const dynamic = "force-dynamic";
export async function GET(request:Request){ const session=await requireSession(); if(!sessionHasPermission(session,"snippet:manage")) return NextResponse.json({error:"缺少权限"},{status:403}); const sp=new URL(request.url).searchParams; return NextResponse.json({ snippets: await listSnippets({ userId: session.userId, q: sp.get("q") ?? undefined, language: sp.get("language") ?? undefined }) }); }
export async function POST(request:Request){ const session=await requireSession(); if(!sessionHasPermission(session,"snippet:manage")) return NextResponse.json({error:"缺少权限"},{status:403}); const body=await request.json(); return NextResponse.json({ snippet: await createSnippet({ ...body, createdBy: session.userId }) }, { status: 201 }); }
