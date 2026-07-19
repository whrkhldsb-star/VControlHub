import { NextResponse } from "next/server";
import { z } from "zod";

const installSchema = z.object({
	slug: z.string().min(1),
	customPort: z.number().int().min(1).max(65535).optional(),
	/** empty/undefined = hub-host; otherwise Server.id */
	serverId: z.string().min(1).optional().nullable(),
});

import { auditUserAction } from "@/lib/audit/service";
import { SERVICE_CATALOG } from "@/lib/quick-service/catalog";
import { config } from "@/lib/config/env";
import { prepareInstallSecrets } from "@/lib/quick-service/install-notice";
import { enqueueQuickServiceJob } from "@/lib/quick-service/job-worker";
import {
	listQuickServices,
	checkPort,
	getUsedPorts,
} from "@/lib/quick-service/service";
import { AppError, ConflictError, ValidationError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { getRemoteApps, normalizedAppToTemplate } from "@/lib/quick-service/app-source-sync";
import { HUB_HOST_INSTANCE_KEY, getDockerEnvironmentStatusFor } from "@/lib/quick-service/docker-cli";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { assertServerTeamAccess } from "@/lib/server/team-access";

export const dynamic = "force-dynamic";

/** GET /api/quick-services — list catalog + installed + remote services */
export async function GET(request: Request) {
	return withApiRoute(request, { permission: "docker:manage", errorStatus: 500, errorMessage: "Server error" }, async ({ session }) => {
		const url = new URL(request.url);
		const serverId = url.searchParams.get("serverId")?.trim() || "";
		const instanceKey = serverId || HUB_HOST_INSTANCE_KEY;
		if (serverId) {
			const access = await assertServerTeamAccess(session, serverId);
			if (!access.ok) return access.response;
		}
		const installed = await listQuickServices(instanceKey);
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
		const docker = await getDockerEnvironmentStatusFor(
			serverId ? { kind: "remote", serverId } : { kind: "local" },
		);
		// Multi-tenant: never return other teams' server id/name/host in the
		// install target picker. Admins (team:manage) still see everything via
		// teamWhere(); non-admins only see their team + unassigned hosts.
		const servers = await prisma.server.findMany({
			where: { enabled: true, ...teamWhere(session!) },
			orderBy: { name: "asc" },
			take: 200,
			select: { id: true, name: true, host: true },
		});
		return NextResponse.json({
			catalog,
			remoteCatalog,
			installed,
			usedPorts,
			docker,
			servers,
			selectedServerId: serverId || null,
			instanceKey,
			publicHost: config.app.publicQuickServiceHost ?? null,
		});
	});
}

/** POST /api/quick-services — install a service (local or remote) */
export async function POST(request: Request) {
	return withApiRoute(request, {
		permission: "docker:manage",
		rateLimit: GENERAL_WRITE_LIMIT,
		bodySchema: installSchema,
		onError(error: unknown) {
			const message = error instanceof Error ? error.message : "installedFailed";
			const isPortError =
				error instanceof ConflictError ||
				(message.includes("port") && message.includes("in use"));
			const status =
				error instanceof AppError ? error.status : isPortError ? 409 : 500;
			return NextResponse.json(
				{ error: message, portConflict: isPortError },
				{ status },
			);
		},
	}, async ({ session, body }) => {
		const { slug, customPort } = body;
		const serverId = body.serverId?.trim() || "";
		const instanceKey = serverId || HUB_HOST_INSTANCE_KEY;

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

		if (!template) throw new ValidationError("Unknown service");

		// Validate custom port if provided
		if (customPort !== undefined) {
			if (isNaN(customPort) || customPort < 1 || customPort > 65535) {
				throw new ValidationError("Invalid port, please enter a number between 1-65535");
			}
			// Host port probe is only reliable for hub-host.
			if (!serverId) {
				const check = checkPort(customPort);
				if (!check.available) {
					return NextResponse.json(
						{ error: `port ${customPort} is already in use (${check.usedBy}), please change port and retry`, portConflict: true, usedBy: check.usedBy },
						{ status: 409 },
					);
				}
			}
		}
		if (serverId) {
			const access = await assertServerTeamAccess(session, serverId);
			if (!access.ok) return access.response;
			const server = await prisma.server.findUnique({ where: { id: serverId }, select: { id: true, enabled: true, name: true } });
			if (!server || !server.enabled) throw new ValidationError("Target VPS not found or disabled");
		}

		const prepared = prepareInstallSecrets(template);
		const { job, taskId, reused } = await enqueueQuickServiceJob({
			title: `Installed quick service: ${template.name}`,
			createdBy: session?.userId ?? null,
			payload: {
				action: "install",
				slug: template.slug,
				template: prepared.template,
				customPort,
				instanceKey,
				serverId: serverId || null,
				installNoticeCredentials: prepared.credentials,
				installNoticeNotes: prepared.notes,
			},
		});
		await auditUserAction(session!.userId, "quick_service.install", {
			slug: template.slug,
			templateName: template.name,
			instanceKey,
			serverId: serverId || null,
		}, undefined, session?.currentTeamId);
		return NextResponse.json({
			success: true,
			queued: true,
			reused,
			jobId: job.id,
			taskId,
			status: job.status,
			notice: { credentials: prepared.credentials, notes: prepared.notes },
			message: reused ? "The service already has a lifecycle task in progress, returning the existing task." : "Quick service installation has been added as a background task, you can check progress in the task center.",
		}, { status: 202 });
	});
}
