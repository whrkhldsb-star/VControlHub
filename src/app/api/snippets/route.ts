import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { createSnippet, listSnippets } from "@/lib/snippet/service";

const snippetPostSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  language: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isPublic: z.boolean().optional(),
});

const snippetPatchSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  content: z.string().optional(),
  language: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isPublic: z.boolean().optional(),
});

export const dynamic = "force-dynamic";
export async function GET(request:Request){ const session=await requireSession(); if(!sessionHasPermission(session,"snippet:manage")) return NextResponse.json({error:"缺少权限"},{status:403}); const sp=new URL(request.url).searchParams; return NextResponse.json({ snippets: await listSnippets({ userId: session.userId, q: sp.get("q") ?? undefined, language: sp.get("language") ?? undefined }) }); }
export async function POST(request:Request){ const session=await requireSession(); if(!sessionHasPermission(session,"snippet:manage")) return NextResponse.json({error:"缺少权限"},{status:403}); const body=await request.json(); const parsed=snippetPostSchema.safeParse(body); if(!parsed.success) return NextResponse.json({error:"输入校验失败",details:parsed.error.flatten().fieldErrors},{status:400}); const data=parsed.data; return NextResponse.json({ snippet: await createSnippet({ ...data, createdBy: session.userId }) }, { status: 201 }); }
