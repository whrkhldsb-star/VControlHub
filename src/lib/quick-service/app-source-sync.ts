/**
 * App Source Sync Service
 *
 * Handles syncing third-party app catalogs into the database.
 * - Fetches from remote sources via adapters
 * - Upserts into AppSourceApp table
 * - Updates AppSource metadata (last sync time, status, etc.)
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { fetchSourceApps, type NormalizedApp } from "./adapters";
import { createLogger } from "@/lib/logging";

const logger = createLogger("app-source:sync");

const MAX_ENABLED_APP_SOURCES = 50;
const MAX_REMOTE_APPS = 500;

type AppSourceAppSlugRow = Prisma.AppSourceAppGetPayload<{ select: { id: true; slug: true } }>;
type RemoteAppRow = Prisma.AppSourceAppGetPayload<{ include: { source: { select: { name: true } } } }>;

/**
 * Sync a single source by ID.
 */
export async function syncSource(sourceId: string): Promise<{ synced: number; errors: number }> {
	const source = await prisma.appSource.findUnique({ where: { id: sourceId } });
	if (!source) throw new Error("源不存在");
	if (!source.enabled) throw new Error("源已禁用");

	try {
		const apps = await fetchSourceApps(source.name, source.type, source.url);

		let synced = 0;
		let errors = 0;

		for (const app of apps) {
			try {
				await prisma.appSourceApp.upsert({
					where: { slug: app.slug },
					update: {
						name: app.name,
						category: app.category,
						icon: app.icon,
						description: app.description,
						image: app.image,
						defaultPort: app.defaultPort,
						internalPort: app.internalPort ?? null,
						path: app.path,
						envJson: JSON.stringify(app.envJson),
						volumesJson: JSON.stringify(app.volumesJson),
						command: app.command ?? null,
						extraPortsJson: JSON.stringify(app.extraPorts ?? []),
						rawJson: app.rawJson ?? null,
						sourceVersion: app.sourceVersion ?? null,
					},
					create: {
						slug: app.slug,
						sourceId: source.id,
						name: app.name,
						category: app.category,
						icon: app.icon,
						description: app.description,
						image: app.image,
						defaultPort: app.defaultPort,
						internalPort: app.internalPort ?? null,
						path: app.path,
						envJson: JSON.stringify(app.envJson),
						volumesJson: JSON.stringify(app.volumesJson),
						command: app.command ?? null,
						extraPortsJson: JSON.stringify(app.extraPorts ?? []),
						rawJson: app.rawJson ?? null,
						sourceVersion: app.sourceVersion ?? null,
					},
				});
				synced++;
			} catch (err) {
				logger.error(`Failed to upsert app ${app.slug}: ${err}`);
				errors++;
			}
		}

		// Remove apps that are no longer in the source
		const remoteSlugs = new Set(apps.map((a) => a.slug));
		const existing = await prisma.appSourceApp.findMany({
			where: { sourceId: source.id },
			select: { id: true, slug: true },
		});
		const toRemove = existing.filter((entry: AppSourceAppSlugRow) => !remoteSlugs.has(entry.slug));
		if (toRemove.length > 0) {
			await prisma.appSourceApp.deleteMany({
				where: { id: { in: toRemove.map((entry: AppSourceAppSlugRow) => entry.id) } },
			});
		}

		// Update source metadata
		await prisma.appSource.update({
			where: { id: source.id },
			data: {
				lastSyncAt: new Date(),
				lastSyncStatus: "success",
				lastSyncError: null,
				syncCount: { increment: 1 },
			},
		});

		logger.info(`Synced ${source.name}: ${synced} apps, ${errors} errors, ${toRemove.length} removed`);
		return { synced, errors };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		await prisma.appSource.update({
			where: { id: source.id },
			data: {
				lastSyncAt: new Date(),
				lastSyncStatus: "error",
				lastSyncError: msg.substring(0, 500),
			},
		});
		throw err;
	}
}

/**
 * Sync all enabled sources.
 */
export async function syncAllSources(): Promise<Array<{ name: string; synced: number; errors: number }>> {
	const sources = await prisma.appSource.findMany({
		where: { enabled: true },
		orderBy: { createdAt: "asc" },
		take: MAX_ENABLED_APP_SOURCES,
	});
	const results = [];

	for (const source of sources) {
		try {
			const result = await syncSource(source.id);
			results.push({ name: source.name, ...result });
		} catch (err) {
			logger.error(`Sync failed for ${source.name}: ${err}`);
			results.push({ name: source.name, synced: 0, errors: 1 });
		}
	}

	return results;
}

/**
 * Get all remote apps from the database, grouped by category.
 */
export async function getRemoteApps(): Promise<NormalizedApp[]> {
	const apps = await prisma.appSourceApp.findMany({
		where: { source: { enabled: true } },
		orderBy: [{ category: "asc" }, { name: "asc" }],
		take: MAX_REMOTE_APPS,
		include: { source: { select: { name: true } } },
	});

	return apps.map((app: RemoteAppRow): NormalizedApp => ({
		slug: app.slug,
		name: app.name,
		category: app.category,
		icon: app.icon,
		description: app.description,
		image: app.image,
		defaultPort: app.defaultPort,
		internalPort: app.internalPort ?? undefined,
		path: app.path,
		envJson: JSON.parse(app.envJson),
		volumesJson: JSON.parse(app.volumesJson),
		command: app.command ?? undefined,
		extraPorts: JSON.parse(app.extraPortsJson || "[]"),
		sourceVersion: app.sourceVersion ?? undefined,
		sourceName: app.source.name,
	}));
}

/**
 * Convert a NormalizedApp to a ServiceTemplate (for installation).
 */
export function normalizedAppToTemplate(app: NormalizedApp): import("./types").ServiceTemplate {
	return {
		slug: app.slug,
		name: app.name,
		category: app.category,
		icon: app.icon,
		description: app.description,
		image: app.image,
		defaultPort: app.defaultPort,
		internalPort: app.internalPort,
		path: app.path,
		envJson: app.envJson,
		volumesJson: app.volumesJson,
		command: app.command,
		extraPorts: app.extraPorts,
	};
}
