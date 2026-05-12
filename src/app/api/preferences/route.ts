/**
 * User preferences API — per-user settings stored in localStorage on client,
 * with optional server-side persistence via the User model.
 * GET  /api/preferences  — get current user preferences
 * PUT  /api/preferences  — update preferences
 */
import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth/api-session";
import { prisma } from "@/lib/db";

export async function GET() {
	try {
		const session = await getApiSession();
		if (!session?.userId) {
			return NextResponse.json({ error: "未授权" }, { status: 401 });
		}

		const user = await prisma.user.findUnique({
			where: { id: session.userId },
			select: { preferences: true },
		});

		const defaults = {
			sidebarCollapsed: false,
			defaultPage: "/",
			dashboardWidgets: ["quick-links", "analytics", "audit-log"],
			notificationsEnabled: true,
			notificationSound: true,
			autoRefreshInterval: 0,
			compactMode: false,
		};

		const prefs = user?.preferences
			? { ...defaults, ...(typeof user.preferences === "object" ? user.preferences : {}) }
			: defaults;

		return NextResponse.json(prefs);
	} catch (error) {
		console.error("[preferences GET]", error);
		return NextResponse.json({ error: "获取偏好设置失败" }, { status: 500 });
	}
}

export async function PUT(request: Request) {
	try {
		const session = await getApiSession();
		if (!session?.userId) {
			return NextResponse.json({ error: "未授权" }, { status: 401 });
		}

		const body = await request.json();

		await prisma.user.update({
			where: { id: session.userId },
			data: { preferences: body },
		});

		return NextResponse.json({ ok: true });
	} catch (error) {
		console.error("[preferences PUT]", error);
		return NextResponse.json({ error: "保存偏好设置失败" }, { status: 500 });
	}
}
