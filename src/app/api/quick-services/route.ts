import { NextResponse } from "next/server";
import { z } from "zod";

const installSchema = z.object({ slug: z.string().min(1), customPort: z.number().int().min(1).max(65535).optional() });

import { SERVICE_CATALOG } from "@/lib/quick-service/catalog";
import { config } from "@/lib/config/env";
import { prepareInstallSecrets } from "@/lib/quick-service/install-notice";
import { enqueueQuickServiceJob } from "@/lib/quick-service/job-worker";
import {
	listQuickServices,
	checkPort,
	getUsedPorts,
} from "@/lib/quick-service/service";
import { getDockerEnvironmentStatus } from "@/lib/quick-service/docker-cli";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { getRemoteApps, normalizedAppToTemplate } from "@/lib/quick-service/app-source-sync";

import { ValidationError } from "@/lib/errors";
export const dynamic = "force-dynamic";

/** GET /api/quick-services — list catalog + installed + remote services */
export async function GET(request: Request) {
	return withApiRoute(request, { permission: "docker:manage", errorStatus: 500, errorMessage: "服务器错误" }, async () => {
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
			envKeyCount: Object.keys(t.envJson ?? {}).length,
			volumesJson: t.volumesJson,
			extraPorts: t.extraPorts ?? [],
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
			envKeyCount: Object.keys(app.envJson ?? {}).length,
			volumesJson: app.volumesJson,
			extraPorts: app.extraPorts ?? [],
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
		return NextResponse.json({ catalog, remoteCatalog, installed, usedPorts, docker, publicHost: config.app.publicQuickServiceHost ?? null });
	});
}

/** POST /api/quick-services — install a service (local or remote) */
export async function POST(request: Request) {
	return withApiRoute(request, {
		permission: "docker:manage",
		rateLimit: GENERAL_WRITE_LIMIT,
		bodySchema: installSchema,
		onError(error) {
			const message = error instanceof Error ? error.message : "安装失败";
			const isPortError = message.includes("端口") && message.includes("占用");
			return NextResponse.json(
				{ error: message, portConflict: isPortError },
				{ status: isPortError ? 409 : 500 },
			);
		},
	}, async ({ session, body }) => {
		const { slug, customPort } = body;

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

		if (!template) throw new ValidationError("未知服务");

		// Validate custom port if provided
		if (customPort !== undefined) {
			if (isNaN(customPort) || customPort < 1 || customPort > 65535) {
				throw new ValidationError("端口号无效，请输入 1-65535 之间的数字");
			}
			const check = checkPort(customPort);
			if (!check.available) {
				return NextResponse.json(
					{ error: `端口 ${customPort} 已被占用（${check.usedBy}），请更换端口后重试`, portConflict: true, usedBy: check.usedBy },
					{ status: 409 },
				);
			}
		}

		const prepared = prepareInstallSecrets(template);
		const { job, taskId, reused } = await enqueueQuickServiceJob({
			title: `安装快捷服务：${template.name}`,
			createdBy: session?.userId ?? null,
			payload: {
				action: "install",
				slug: template.slug,
				template: prepared.template,
				customPort,
				installNoticeCredentials: prepared.credentials,
				installNoticeNotes: prepared.notes,
			},
		});
		return NextResponse.json({
			success: true,
			queued: true,
			reused,
			jobId: job.id,
			taskId,
			status: job.status,
			notice: { credentials: prepared.credentials, notes: prepared.notes },
			message: reused ? "该服务已有进行中的生命周期任务，已返回现有任务。" : "QuickService 安装已加入后台任务，可在任务中心查看进度。",
		}, { status: 202 });
	});
}
