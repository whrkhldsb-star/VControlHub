import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listQuickServices, SERVICE_CATALOG, installService } from "@/lib/quick-service/service";

export const dynamic = "force-dynamic";

export async function GET() {
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "user:manage"))
			return NextResponse.json({ error: "权限不足" }, { status: 403 });

		const installed = await listQuickServices();
		const installedMap = new Map(installed.map((s) => [s.slug, s]));
		const catalog = SERVICE_CATALOG.map((t) => ({
			...t,
			status: installedMap.has(t.slug) ? installedMap.get(t.slug)!.status : "available",
			id: installedMap.get(t.slug)?.id ?? null,
			containerId: installedMap.get(t.slug)?.containerId ?? null,
			error: installedMap.get(t.slug)?.error ?? null,
		}));
		return NextResponse.json({ catalog, installed });
	} catch {
		return NextResponse.json({ error: "未认证" }, { status: 401 });
	}
}

export async function POST(request: Request) {
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "user:manage"))
			return NextResponse.json({ error: "权限不足" }, { status: 403 });

		const body = await request.json();
		const slug = (body.slug ?? "").trim();
		const template = SERVICE_CATALOG.find((t) => t.slug === slug);
		if (!template) return NextResponse.json({ error: "未知服务" }, { status: 400 });

		const svc = await installService(template, session.userId);
		return NextResponse.json({ service: svc }, { status: 201 });
	} catch (err) {
		const msg = err instanceof Error ? err.message : "安装失败";
		return NextResponse.json({ error: msg }, { status: 500 });
	}
}
