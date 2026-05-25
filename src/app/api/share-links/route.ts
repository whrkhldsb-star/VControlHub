import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { createShareLink, listShareLinks, revokeShareLink } from "@/lib/share-link/service";
import { withRateLimit, rateLimitResponse, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

const shareLinkPostSchema = z.object({
 storageNodeId: z.string().min(1),
 path: z.string().min(1),
 entryType: z.enum(["FILE", "DIRECTORY"]).optional(),
 name: z.string().optional(),
 expiresInHours: z.number().positive().optional(),
 expiresIn: z.number().positive().optional(),
});

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!sessionHasPermission(session, "share:read")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  return NextResponse.json({ shares: await listShareLinks() });
}

export async function POST(request: Request) {
  const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
  try {
    const session = await requireSession();
    if (!sessionHasPermission(session, "share:create")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
   const body = await request.json().catch(() => null);
   if (!body) return NextResponse.json({ error: "请求体无效" }, { status: 400 });
   const parsed = shareLinkPostSchema.safeParse(body);
   if (!parsed.success) return NextResponse.json({ error: "输入校验失败", details: parsed.error.flatten().fieldErrors }, { status: 400 });
    const data = parsed.data;
    const result = await createShareLink({ session, storageNodeId: data.storageNodeId, path: data.path, entryType: data.entryType, name: data.name, expiresInHours: data.expiresInHours ?? data.expiresIn });
    return NextResponse.json({ share: result.share, token: result.token }, { status: 201 });
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
    if (!sessionHasPermission(session, "share:manage")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id 必填" }, { status: 400 });
    return NextResponse.json({ share: await revokeShareLink(id) });
  } catch (error) {
  	const message = error instanceof Error ? error.message : "操作失败";
  	return NextResponse.json({ error: message }, { status: 500 });
  }
}
