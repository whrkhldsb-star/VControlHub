import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logging";

const logger = createLogger("api:servers:monitor");

import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { collectServerMetrics } from "@/lib/server/monitor";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	let session;
	try {
		session = await requireSession();
	} catch (error) {
		logger.error("获取服务器监控数据时会话验证失败", error);
		return NextResponse.json({ error: "服务器错误" }, { status: 500 });
	}

	if (!sessionHasPermission(session, "server:read")) {
		return NextResponse.json({ error: "权限不足" }, { status: 403 });
	}

	const { searchParams } = new URL(request.url);
	const serverId = searchParams.get("serverId");
	if (!serverId) {
		return NextResponse.json({ error: "缺少 serverId" }, { status: 400 });
	}

	const result = await collectServerMetrics(serverId);
	return NextResponse.json(result);
}
