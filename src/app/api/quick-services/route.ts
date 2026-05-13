import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logging";

const logger = createLogger("api:quick-services");

import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { SERVICE_CATALOG } from "@/lib/quick-service/catalog";
import {
	listQuickServices,
	installService,
	checkPort,
	allocatePort,
	isPortAvailableSync,
	getUsedPorts,
} from "@/lib/quick-service/service";

export const dynamic = "force-dynamic";

/** GET /api/quick-services — list catalog + installed services */
export async function GET() {
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "user:manage"))
			return NextResponse.json({ error: "权限不足" }, { status: 403 });

		const installed = await listQuickServices();
		const installedMap = new Map(installed.map((s) => [s.slug, s]));
		const catalog = SERVICE_CATALOG.map((t) => ({
			slug: t.slug,
			name: t.name,
			category: t.category,
			icon: t.icon,
			description: t.description,
			image: t.image,
			defaultPort: t.defaultPort,
			internalPort: t.internalPort ?? null,
			path: t.path,
			status: installedMap.has(t.slug) ? installedMap.get(t.slug)!.status : "available",
			id: installedMap.get(t.slug)?.id ?? null,
			containerId: installedMap.get(t.slug)?.containerId ?? null,
			port: installedMap.get(t.slug)?.port ?? null,
			error: installedMap.get(t.slug)?.error ?? null,
		}));
		const usedPorts = getUsedPorts();
		return NextResponse.json({ catalog, installed, usedPorts });
	} catch (error) {
		logger.error("获取快捷服务列表失败", error);
		return NextResponse.json({ error: "服务器错误" }, { status: 500 });
	}
}

/** POST /api/quick-services — install a service */
export async function POST(request: Request) {
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "user:manage"))
			return NextResponse.json({ error: "权限不足" }, { status: 403 });

		const body = await request.json();
		const slug = (body.slug ?? "").trim();
		const customPort = body.customPort ? Number(body.customPort) : undefined;
		const template = SERVICE_CATALOG.find((t) => t.slug === slug);
		if (!template) return NextResponse.json({ error: "未知服务" }, { status: 400 });

		// Validate custom port if provided
		if (customPort !== undefined) {
			if (isNaN(customPort) || customPort < 1 || customPort > 65535) {
				return NextResponse.json({ error: "端口号无效，请输入 1-65535 之间的数字" }, { status: 400 });
			}
			const check = checkPort(customPort);
			if (!check.available) {
				return NextResponse.json(
					{ error: `端口 ${customPort} 已被占用（${check.usedBy}），请更换端口后重试`, portConflict: true, usedBy: check.usedBy },
					{ status: 409 },
				);
			}
		}

		const svc = await installService({ template, userId: session.userId, customPort });
		return NextResponse.json({ service: svc }, { status: 201 });
	} catch (err) {
		const msg = err instanceof Error ? err.message : "安装失败";
		const isPortError = msg.includes("端口") && msg.includes("占用");
		return NextResponse.json(
			{ error: msg, portConflict: isPortError },
			{ status: isPortError ? 409 : 500 },
		);
	}
}
