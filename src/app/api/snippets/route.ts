import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { createSnippet, listSnippets, updateSnippet, deleteSnippet } from "@/lib/snippet/service";
import { withRateLimit, rateLimitResponse, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

const snippetPostSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  language: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isPublic: z.boolean().optional(),
});

const snippetPatchSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  language: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isPrivate: z.boolean().optional(),
  description: z.string().optional(),
});

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!sessionHasPermission(session, "snippet:manage")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
    const sp = new URL(request.url).searchParams;
    return NextResponse.json({ snippets: await listSnippets({ userId: session.userId, q: sp.get("q") ?? undefined, language: sp.get("language") ?? undefined }) });
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
    if (!sessionHasPermission(session, "snippet:manage")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
    const body = await request.json();
    const parsed = snippetPostSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "输入校验失败", details: parsed.error.flatten().fieldErrors }, { status: 400 });
    const data = parsed.data;
    return NextResponse.json({ snippet: await createSnippet({ ...data, createdBy: session.userId }) }, { status: 201 });
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
    if (!sessionHasPermission(session, "snippet:manage")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
    const body = await request.json();
    const parsed = snippetPatchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "输入校验失败", details: parsed.error.flatten().fieldErrors }, { status: 400 });
    const { id, ...data } = parsed.data;
    const snippet = await updateSnippet(id, data);
    return NextResponse.json({ snippet });
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
    if (!sessionHasPermission(session, "snippet:manage")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "缺少片段 ID" }, { status: 400 });
    await deleteSnippet(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
