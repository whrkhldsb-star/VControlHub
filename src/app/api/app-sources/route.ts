import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { withRateLimit, rateLimitResponse, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { syncSource, syncAllSources, getRemoteApps } from "@/lib/quick-service/app-source-sync";
import { SERVICE_CATALOG } from "@/lib/quick-service/catalog";
import { listQuickServices } from "@/lib/quick-service/service";
import { normalizedAppToTemplate } from "@/lib/quick-service/app-source-sync";
import { createLogger } from "@/lib/logging";

const logger = createLogger("api:app-sources");

export const dynamic = "force-dynamic";

/* ── GET /api/app-sources — list sources + remote apps ────────── */

export async function GET(request: Request) {
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "user:manage"))
			return NextResponse.json({ error: "权限不足" }, { status: 403 });

		const { searchParams } = new URL(request.url);
		const includeApps = searchParams.get("includeApps") !== "false";

		// Get all sources
		const sources = await prisma.appSource.findMany({
			orderBy: [{ name: "asc" }],
		});

		// Get remote apps if requested
		let remoteApps: any[] = [];
		if (includeApps) {
			remoteApps = await getRemoteApps();
		}

		// Get installed services for status mapping
		const installed = await listQuickServices();
		const installedMap = new Map(installed.map((s) => [s.slug, s]));

		// Build local catalog with install status
		const localCatalog = SERVICE_CATALOG.map((t) => ({
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
			source: "local" as const,
		}));

		// Build remote catalog with install status
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
			source: app.sourceName as string,
			stars: app.stars,
			monthlyPulls: app.monthlyPulls,
		}));

		return NextResponse.json({
			sources,
			localCatalog,
			remoteCatalog,
		});
	} catch (error) {
		logger.error("获取应用源列表失败", error);
		return NextResponse.json({ error: "服务器错误" }, { status: 500 });
	}
}

/* ── POST /api/app-sources — add a new source ─────────────────── */

const addSourceSchema = z.object({
	name: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
	displayName: z.string().min(1).max(128),
	url: z.string().url(),
	type: z.enum(["json", "github", "linuxserver"]).default("json"),
});

export async function POST(request: Request) {
	const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
	if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "user:manage"))
			return NextResponse.json({ error: "权限不足" }, { status: 403 });

		const parsed = addSourceSchema.safeParse(await request.json());
		if (!parsed.success)
			return NextResponse.json({ error: "输入参数无效", details: parsed.error.flatten() }, { status: 400 });

		const source = await prisma.appSource.create({
			data: {
				name: parsed.data.name,
				displayName: parsed.data.displayName,
				url: parsed.data.url,
				type: parsed.data.type,
			},
		});

		return NextResponse.json({ source }, { status: 201 });
	} catch (error) {
		const msg = error instanceof Error ? error.message : "添加源失败";
		if (msg.includes("Unique")) {
			return NextResponse.json({ error: "源名称已存在" }, { status: 409 });
		}
		logger.error("添加应用源失败", error);
		return NextResponse.json({ error: msg }, { status: 500 });
	}
}

/* ── PATCH /api/app-sources — sync sources ─────────────────────── */

const syncSchema = z.object({
	action: z.literal("sync"),
	sourceId: z.string().optional(), // if omitted, sync all
});

const toggleSchema = z.object({
	action: z.literal("toggle"),
	sourceId: z.string(),
	enabled: z.boolean(),
});

const updateSchema = z.discriminatedUnion("action", [syncSchema, toggleSchema]);

export async function PATCH(request: Request) {
	const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
	if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "user:manage"))
			return NextResponse.json({ error: "权限不足" }, { status: 403 });

		const body = await request.json();
		const parsed = updateSchema.safeParse(body);
		if (!parsed.success)
			return NextResponse.json({ error: "输入参数无效", details: parsed.error.flatten() }, { status: 400 });

		const data = parsed.data;

		if (data.action === "sync") {
			if (data.sourceId) {
				const result = await syncSource(data.sourceId);
				return NextResponse.json({ result });
			} else {
				const results = await syncAllSources();
				return NextResponse.json({ results });
			}
		}

		if (data.action === "toggle") {
			await prisma.appSource.update({
				where: { id: data.sourceId },
				data: { enabled: data.enabled },
			});
			return NextResponse.json({ ok: true });
		}

		return NextResponse.json({ error: "未知操作" }, { status: 400 });
	} catch (error) {
		const msg = error instanceof Error ? error.message : "操作失败";
		logger.error("应用源操作失败", error);
		return NextResponse.json({ error: msg }, { status: 500 });
	}
}

/* ── DELETE /api/app-sources?sourceId=xxx — remove a source ──── */

export async function DELETE(request: Request) {
	const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
	if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "user:manage"))
			return NextResponse.json({ error: "权限不足" }, { status: 403 });

		const { searchParams } = new URL(request.url);
		const sourceId = searchParams.get("sourceId");
		if (!sourceId) return NextResponse.json({ error: "缺少 sourceId" }, { status: 400 });

		await prisma.appSource.delete({ where: { id: sourceId } });
		return NextResponse.json({ ok: true });
	} catch (error) {
		const msg = error instanceof Error ? error.message : "删除失败";
		logger.error("删除应用源失败", error);
		return NextResponse.json({ error: msg }, { status: 500 });
	}
}
