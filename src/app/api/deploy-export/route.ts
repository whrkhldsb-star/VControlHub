import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { buildPortableDeploymentPackage, createDeploymentExport } from "@/lib/deploy-export/service";
export const dynamic = "force-dynamic";
export async function GET(request:Request){ const session=await requireSession(); if(!sessionHasPermission(session,"deploy:export")) return NextResponse.json({error:"缺少权限"},{status:403}); const domain=new URL(request.url).searchParams.get("domain") ?? undefined; return NextResponse.json(buildPortableDeploymentPackage({ domain })); }
export async function POST(request:Request){ const session=await requireSession(); if(!sessionHasPermission(session,"deploy:export")) return NextResponse.json({error:"缺少权限"},{status:403}); const body=await request.json().catch(()=>({})); return NextResponse.json({ export: await createDeploymentExport({ userId: session.userId, domain: body.domain, appName: body.appName }) }, { status: 201 }); }
