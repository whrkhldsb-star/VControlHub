import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { createSnippet, deleteSnippet, listSnippets, updateSnippet } from "@/lib/snippet/service";

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
  return withApiRoute(request, { permission: "snippet:manage" }, async ({ session }) => {
    const sp = new URL(request.url).searchParams;
    return NextResponse.json({
      snippets: await listSnippets({
        userId: session?.userId,
        q: sp.get("q") ?? undefined,
        language: sp.get("language") ?? undefined,
      }),
    });
  });
}

export async function POST(request: Request) {
  return withApiRoute(request, { permission: "snippet:manage", rateLimit: GENERAL_WRITE_LIMIT }, async ({ session }) => {
    const parsed = snippetPostSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "输入校验失败", details: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    return NextResponse.json(
      { snippet: await createSnippet({ ...parsed.data, createdBy: session?.userId }) },
      { status: 201 },
    );
  });
}

export async function PATCH(request: Request) {
  return withApiRoute(request, { permission: "snippet:manage", rateLimit: GENERAL_WRITE_LIMIT }, async () => {
    const parsed = snippetPatchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "输入校验失败", details: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const { id, ...data } = parsed.data;
    return NextResponse.json({ snippet: await updateSnippet(id, data) });
  });
}

export async function DELETE(request: Request) {
  return withApiRoute(request, { permission: "snippet:manage", rateLimit: GENERAL_WRITE_LIMIT }, async () => {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "缺少片段 ID" }, { status: 400 });

    await deleteSnippet(id);
    return NextResponse.json({ success: true });
  });
}
