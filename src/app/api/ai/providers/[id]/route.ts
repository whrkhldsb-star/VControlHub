import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/require-api-permission";
import {
  getProviderById,
  updateProvider,
  deleteProvider,
} from "@/lib/ai/service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authed = await requireApiPermission("ai:manage");
	if (authed instanceof NextResponse) return authed;
	const { session } = authed;
    const { id } = await params;
    const provider = await getProviderById(id, session.userId);
    // Mask API key
    return NextResponse.json({
      provider: {
        ...provider,
        apiKey: provider.apiKey.slice(0, 8) + "..." + provider.apiKey.slice(-4),
        createdAt: provider.createdAt.toISOString(),
        updatedAt: provider.updatedAt.toISOString(),
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "未找到";
    return NextResponse.json({ error: msg }, { status: 404 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authed = await requireApiPermission("ai:manage");
	if (authed instanceof NextResponse) return authed;
	const { session } = authed;
    const { id } = await params;
    const body = await request.json();
    const provider = await updateProvider(id, session.userId, body);
    return NextResponse.json({
      provider: {
        ...provider,
        apiKey: provider.apiKey.slice(0, 8) + "..." + provider.apiKey.slice(-4),
        createdAt: provider.createdAt.toISOString(),
        updatedAt: provider.updatedAt.toISOString(),
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "更新失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authed = await requireApiPermission("ai:manage");
	if (authed instanceof NextResponse) return authed;
	const { session } = authed;
    const { id } = await params;
    await deleteProvider(id, session.userId);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "删除失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
