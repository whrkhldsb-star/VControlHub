import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { listUserNotifications, getUnreadCount, markAsRead, markAllAsRead, deleteNotification } from "@/lib/notification/service";

export const dynamic = "force-dynamic";

export async function GET() {
	try {
		const session = await requireSession();
		const [notifications, unreadCount] = await Promise.all([
			listUserNotifications(session.userId, { limit: 50 }),
			getUnreadCount(session.userId),
		]);
		return NextResponse.json({ notifications, unreadCount });
	} catch {
		return NextResponse.json({ error: "未认证" }, { status: 401 });
	}
}

export async function PATCH(request: Request) {
	try {
		const session = await requireSession();
		const body = await request.json();

		if (body.markAllAsRead) {
			await markAllAsRead(session.userId);
			return NextResponse.json({ success: true });
		}

		if (body.notificationId) {
			await markAsRead(body.notificationId, session.userId);
			return NextResponse.json({ success: true });
		}

		return NextResponse.json({ error: "无效请求" }, { status: 400 });
	} catch {
		return NextResponse.json({ error: "未认证" }, { status: 401 });
	}
}

export async function DELETE(request: Request) {
	try {
		const session = await requireSession();
		const { searchParams } = new URL(request.url);
		const notificationId = searchParams.get("id");
		if (!notificationId) {
			return NextResponse.json({ error: "缺少通知 ID" }, { status: 400 });
		}
		await deleteNotification(notificationId, session.userId);
		return NextResponse.json({ success: true });
	} catch {
		return NextResponse.json({ error: "未认证" }, { status: 401 });
	}
}
