import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getAllSettings, setManySettings } from "@/lib/settings/service";

export const dynamic = "force-dynamic";

export async function GET() {
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "user:manage")) {
			return NextResponse.json({ error: "权限不足" }, { status: 403 });
		}
		const settings = await getAllSettings();
		return NextResponse.json({ settings });
	} catch {
		return NextResponse.json({ error: "未认证" }, { status: 401 });
	}
}

export async function PATCH(request: Request) {
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "user:manage")) {
			return NextResponse.json({ error: "权限不足" }, { status: 403 });
		}
		const body = await request.json();
		const entries = Object.entries(body)
			.filter(([, v]) => typeof v === "string")
			.map(([key, value]) => ({ key, value: value as string }));
		await setManySettings(entries);
		return NextResponse.json({ success: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : "保存失败";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}
