import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { createApiToken, listApiTokens, revokeApiToken } from "@/lib/api-token/service";
export const dynamic = "force-dynamic";
export async function GET(){ const session=await requireSession(); if(!sessionHasPermission(session,"api-token:manage")) return NextResponse.json({error:"缺少权限"},{status:403}); return NextResponse.json({ tokens: await listApiTokens(session.userId) }); }
export async function POST(request:Request){ const session=await requireSession(); if(!sessionHasPermission(session,"api-token:manage")) return NextResponse.json({error:"缺少权限"},{status:403}); const body=await request.json().catch(()=>null); const result=await createApiToken({ userId: session.userId, name: body?.name ?? "API Token", scopes: body?.scopes, expiresAt: body?.expiresAt ? new Date(body.expiresAt) : null }); return NextResponse.json({ token: result.token, apiToken: result.apiToken }, { status: 201 }); }
export async function DELETE(request:Request){ const session=await requireSession(); if(!sessionHasPermission(session,"api-token:manage")) return NextResponse.json({error:"缺少权限"},{status:403}); const id=new URL(request.url).searchParams.get("id"); if(!id) return NextResponse.json({error:"id 必填"},{status:400}); return NextResponse.json({ token: await revokeApiToken({ userId: session.userId, id }) }); }
