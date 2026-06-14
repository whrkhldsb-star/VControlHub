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
import { BusinessError, NotFoundError } from "@/lib/errors";
import { fetchSourceApps, type NormalizedApp } from "./adapters";
import { createLogger } from "@/lib/logging";

const logger = createLogger("app-source:sync");

const MAX_ENABLED_APP_SOURCES = 50;
const MAX_REMOTE_APPS = 500;

type AppSourceAppSlugRow = Prisma.AppSourceAppGetPayload<{ select: { id: true; slug: true } }>;
type RemoteAppRow = Prisma.AppSourceAppGetPayload<{ include: { source: { select: { name: true } } } }>;

/**
 * Sync a single source by ID.
 *
 * TR-040: app upserts are processed in concurrent chunks so a typical
 * 500-app source completes in ~O(N/CONCURRENCY) DB round-trips instead
 * of O(N) sequential round-trips. Chunk size is bounded to stay friendly
 * to the Prisma connection pool (default poolSize=10).
 */
const APP_UPSERT_CONCURRENCY = 8;

export async function syncSource(sourceId: string): Promise<{ synced: number; errors: number }> {
	const source = await prisma.appSource.findUnique({ where: { id: sourceId } });
	if (!source) throw new NotFoundError("源不存在");
	if (!source.enabled) throw new BusinessError("源已禁用");

	try {
		const apps = await fetchSourceApps(source.name, source.type, source.url);

		let synced = 0;
		let errors = 0;

		// Process apps in concurrent chunks to bound parallelism and DB load.
		for (let i = 0; i < apps.length; i += APP_UPSERT_CONCURRENCY) {
			const chunk = apps.slice(i, i + APP_UPSERT_CONCURRENCY);
			const outcomes = await Promise.all(
				chunk.map(async (app) => {
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
						return "ok" as const;
					} catch (err) {
						logger.error(`Failed to upsert app ${app.slug}: ${err}`);
						return "err" as const;
					}
				}),
			);
			for (const r of outcomes) {
				if (r === "ok") synced++;
				else errors++;
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
const SYNC_ALL_CONCURRENCY = 4;

export async function syncAllSources(): Promise<Array<{ name: string; synced: number; errors: number }>> {
	const sources = await prisma.appSource.findMany({
		where: { enabled: true },
		orderBy: { createdAt: "asc" },
		take: MAX_ENABLED_APP_SOURCES,
	});
	const results: Array<{ name: string; synced: number; errors: number }> = [];

	// TR-040: each `syncSource` call is independent (own transaction, own
	// source metadata row), so fan them out in bounded chunks. Concurrency
	// 4 is well below the default Prisma pool (10) even when each sync
	// internally batches 8 upserts at a time.
	for (let i = 0; i < sources.length; i += SYNC_ALL_CONCURRENCY) {
		const chunk = sources.slice(i, i + SYNC_ALL_CONCURRENCY);
		const chunkResults = await Promise.all(
			chunk.map(async (source) => {
				try {
					const result = await syncSource(source.id);
					return { name: source.name, ...result };
				} catch (err) {
					logger.error(`Sync failed for ${source.name}: ${err}`);
					return { name: source.name, synced: 0, errors: 1 };
				}
			}),
		);
		results.push(...chunkResults);
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
