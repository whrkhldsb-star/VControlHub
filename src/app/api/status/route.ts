import { NextResponse } from "next/server";
import { getPublicStatus, getPublicStatusSummary } from "@/lib/status/service";
import { getApiSession } from "@/lib/auth/api-session";
export const dynamic = "force-dynamic";
export async function GET(){
	const session = await getApiSession();
	// TR-053: 公开端点（未登录）只返 overall；详细 checks 仅登录用户可见。
	const payload = session ? await getPublicStatus() : await getPublicStatusSummary();
	return NextResponse.json(payload);
}
