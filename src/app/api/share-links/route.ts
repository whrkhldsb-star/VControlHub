import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { createShareLink, listShareLinks, revokeShareLink } from "@/lib/share-link/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!sessionHasPermission(session, "share:read")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  return NextResponse.json({ shares: await listShareLinks() });
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!sessionHasPermission(session, "share:create")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body?.storageNodeId || !body?.path) return NextResponse.json({ error: "storageNodeId 与 path 必填" }, { status: 400 });
  const result = await createShareLink({ session, storageNodeId: body.storageNodeId, path: body.path, entryType: body.entryType, name: body.name, expiresInHours: body.expiresInHours });
  return NextResponse.json({ share: result.share, token: result.token }, { status: 201 });
}

export async function DELETE(request: Request) {
  const session = await requireSession();
  if (!sessionHasPermission(session, "share:manage")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 必填" }, { status: 400 });
  return NextResponse.json({ share: await revokeShareLink(id) });
}
