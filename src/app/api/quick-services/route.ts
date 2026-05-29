import { NextResponse } from "next/server";
import { z } from "zod";

const installSchema = z.object({ slug: z.string().min(1), customPort: z.number().int().min(1).max(65535).optional() });

import { SERVICE_CATALOG } from "@/lib/quick-service/catalog";
import {
	listQuickServices,
	installService,
	checkPort,
	getUsedPorts,
	getDockerEnvironmentStatus,
} from "@/lib/quick-service/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { getRemoteApps, normalizedAppToTemplate } from "@/lib/quick-service/app-source-sync";

export const dynamic = "force-dynamic";

/** GET /api/quick-services — list catalog + installed + remote services */
export async function GET(request: Request) {
	return withApiRoute(request, { permission: "user:manage", errorStatus: 500, errorMessage: "服务器错误" }, async () => {
		const installed = await listQuickServices();
		const installedMap = new Map(installed.map((s) => [s.slug, s]));

		// Local catalog
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
			source: "local",
		}));

		// Remote catalog (from synced app sources)
		const remoteApps = await getRemoteApps();
		const remoteCatalog = remoteApps.map((app) => ({
			slug: app.slug,
			name: app.name,
			category: app.category,
			icon: app.icon,
			description: app.description,
			image: app.image,
			defaultPort: app.defaultPort,
			internalPort: app.internalPort ?? null,
			path: app.path,
			status: installedMap.has(app.slug) ? installedMap.get(app.slug)!.status : "available",
			id: installedMap.get(app.slug)?.id ?? null,
			containerId: installedMap.get(app.slug)?.containerId ?? null,
			port: installedMap.get(app.slug)?.port ?? null,
			error: installedMap.get(app.slug)?.error ?? null,
			source: app.sourceName,
			stars: app.stars,
			monthlyPulls: app.monthlyPulls,
		}));

		const usedPorts = getUsedPorts();
		const docker = getDockerEnvironmentStatus();
		return NextResponse.json({ catalog, remoteCatalog, installed, usedPorts, docker });
	});
}

/** POST /api/quick-services — install a service (local or remote) */
export async function POST(request: Request) {
	return withApiRoute(request, {
		permission: "user:manage",
		rateLimit: GENERAL_WRITE_LIMIT,
		onError(error) {
			const message = error instanceof Error ? error.message : "安装失败";
			const isPortError = message.includes("端口") && message.includes("占用");
			return NextResponse.json(
				{ error: message, portConflict: isPortError },
				{ status: isPortError ? 409 : 500 },
			);
		},
	}, async ({ session }) => {
		const parsed = installSchema.safeParse(await request.json());
		if (!parsed.success) return NextResponse.json({ error: "输入参数无效" }, { status: 400 });
		const { slug, customPort } = parsed.data;

		// First try local catalog
		let template = SERVICE_CATALOG.find((t) => t.slug === slug);

		// If not found locally, try remote apps
		if (!template) {
			const remoteApps = await getRemoteApps();
			const remoteApp = remoteApps.find((a) => a.slug === slug);
			if (remoteApp) {
				template = normalizedAppToTemplate(remoteApp);
			}
		}

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

		const svc = await installService({ template, userId: session?.userId ?? "", customPort });
		return NextResponse.json({ service: svc }, { status: 201 });
	});
}
