import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listAlertRules, createAlertRule, updateAlertRule, deleteAlertRule, toggleAlertRule } from "@/lib/alert/service";
import { evaluateAlerts } from "@/lib/health/service";

export const dynamic = "force-dynamic";

export async function GET() {
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "user:manage")) {
			return NextResponse.json({ error: "权限不足" }, { status: 403 });
		}
		const rules = await listAlertRules();
		return NextResponse.json({ rules });
	} catch {
		return NextResponse.json({ error: "未认证" }, { status: 401 });
	}
}

export async function POST(request: Request) {
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "user:manage")) {
			return NextResponse.json({ error: "权限不足" }, { status: 403 });
		}
		const body = await request.json();
		const rule = await createAlertRule(body);
		return NextResponse.json({ rule });
	} catch (err) {
		const message = err instanceof Error ? err.message : "创建失败";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}

export async function PATCH(request: Request) {
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "user:manage")) {
			return NextResponse.json({ error: "权限不足" }, { status: 403 });
		}
		const body = await request.json();
		if (body.toggleId) {
			const result = await toggleAlertRule(body.toggleId);
			return NextResponse.json({ rule: result });
		}
		if (!body.id) return NextResponse.json({ error: "缺少规则 ID" }, { status: 400 });
		const result = await updateAlertRule(body.id, body);
		return NextResponse.json({ rule: result });
	} catch (err) {
		const message = err instanceof Error ? err.message : "更新失败";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}

export async function DELETE(request: Request) {
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "user:manage")) {
			return NextResponse.json({ error: "权限不足" }, { status: 403 });
		}
		const { searchParams } = new URL(request.url);
		const id = searchParams.get("id");
		if (!id) return NextResponse.json({ error: "缺少规则 ID" }, { status: 400 });
		await deleteAlertRule(id);
		return NextResponse.json({ success: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : "删除失败";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}

/* ── Manual trigger endpoint ──────────────────────────────── */

export async function PUT() {
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "user:manage")) {
			return NextResponse.json({ error: "权限不足" }, { status: 403 });
		}
		await evaluateAlerts();
		return NextResponse.json({ success: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : "检测失败";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}
