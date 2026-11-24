import { SERVICE_CATALOG } from "./catalog";
/**
 * App Source Sync Service
 *
 * Handles syncing third-party app catalogs into the database.
 * - Fetches from remote sources via adapters
 * - Upserts into AppSourceApp table
 * - Updates AppSource metadata (last sync time, status, etc.)
 */

import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { Prisma } from "@prisma/client";

import { isUniqueViolation, prisma } from "@/lib/db";
import { BusinessError, NotFoundError } from "@/lib/errors";
import { fetchSourceApps, type NormalizedApp } from "./adapters";
import { createLogger } from "@/lib/logging";
import { t } from "@/lib/i18n/service-translations";

const logger = createLogger("app-source:sync");

const builtinSlugs = new Set(SERVICE_CATALOG.map(app => app.slug));
const SOURCE_PAGE_SIZE = 50;
// The adapters keep up to 5000 apps per source (APP_SOURCE_MAX_APPS); this
// module used to stop at 500, so the community tab silently lost the rest and
// the stale-row cleanup compared against the wrong cap (A6-11).
const MAX_REMOTE_APPS = 5000;
const SOURCE_APP_CLEANUP_PAGE_SIZE = 500;

type AppSourceAppSlugRow = Prisma.AppSourceAppGetPayload<{ select: { id: true; slug: true } }>;
type RemoteAppRow = Prisma.AppSourceAppGetPayload<{ include: { source: { select: { name: true } } } }>;

/**
 * Sync a single source by ID.
 *
 * Upserts run with bounded concurrency so large catalogs cannot stampede the
 * Prisma pool. Per-row try/catch keeps failure isolation (one bad slug does
 * not abort the others).
 */
/** Max in-flight app upserts per source sync (pool-safe). */
const SYNC_UPSERT_CONCURRENCY = 8;

export async function syncSource(sourceId: string): Promise<{ synced: number; errors: number }> {
	const release = await acquireAdvisoryLock("app-source-sync", sourceId);
	try {
		return await syncLockedSource(sourceId);
	} finally {
		await release();
	}
}

async function syncLockedSource(sourceId: string) {
	const source = await prisma.appSource.findUnique({ where: { id: sourceId } });
	if (!source) throw new NotFoundError(t("backend.quick-service.sourceNotFound"));
	if (!source.enabled) throw new BusinessError(t("backend.quick-service.sourceIsDisabled"));

	try {
		const { apps, complete, rejected = 0 } = await fetchSourceApps(source.name, source.type, source.url);

		let synced = 0;
		let errors = rejected;

		// Bounded concurrency: chunked Promise.all over SYNC_UPSERT_CONCURRENCY.
		// Per-row try/catch isolates failures so one bad slug never aborts the rest.
			const outcomes: Array<"ok" | "err"> = [];
			for (let i = 0; i < apps.length; i += SYNC_UPSERT_CONCURRENCY) {
				const chunk = apps.slice(i, i + SYNC_UPSERT_CONCURRENCY);
				const chunkOutcomes = await Promise.all(
					chunk.map(async (app) => {
						if (builtinSlugs.has(app.slug)) return "err" as const;
						try {
							// Shared column payload (TR: update/create used to duplicate
							// these 14 fields verbatim); only slug/sourceId are create-only.
							const fields = {
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
							};
							// "<source>-<app>" can collide across sources ("feed" +
							// "tools-demo" and "feed-tools" + "demo"): never let one
							// source overwrite another's app (it kept the other's
							// ownership); report the clash instead. Each write is
							// atomic — update only a row this source holds, or create
							// one — so two sources syncing at once cannot both "find
							// it free" and overwrite each other.
							const ownUpdate = () => prisma.appSourceApp.updateMany({ where: { slug: app.slug, sourceId: source.id }, data: fields });
							if ((await ownUpdate()).count === 1) return "ok" as const;
							try {
								await prisma.appSourceApp.create({ data: { slug: app.slug, sourceId: source.id, ...fields } });
								return "ok" as const;
							} catch (error) {
								if (!isUniqueViolation(error)) throw error;
								// Created meanwhile: ours (a concurrent sync of this source) or another's.
								if ((await ownUpdate()).count === 1) return "ok" as const;
								logger.warn(`App ${app.slug} of ${source.name} collides with another source's app; skipped`);
								return "err" as const;
							}
						} catch (err) {
							logger.error(`Failed to upsert app ${app.slug}: ${err}`);
							return "err" as const;
						}
					}),
				);
				outcomes.push(...chunkOutcomes);
			}
		for (const r of outcomes) {
			if (r === "ok") synced++;
			else errors++;
		}

		// Remove apps that are no longer in the source. Read all existing rows in
		// pages; a fixed take would leave stale catalog entries forever once a
		// source grows beyond the arbitrary cap.
		const remoteSlugs = new Set(apps.map((a) => a.slug));
		let removed = 0;
		let lastExistingId: string | undefined;
		// The adapters cap remote results. Never delete rows when the source may
		// have been truncated, otherwise a large healthy catalog can be damaged.
		if (complete && errors === 0) {
			const staleIds: string[] = [];
			while (true) {
				const existing = await prisma.appSourceApp.findMany({
					where: { sourceId: source.id },
					select: { id: true, slug: true },
					orderBy: { id: "asc" },
					take: SOURCE_APP_CLEANUP_PAGE_SIZE,
					...(lastExistingId ? { cursor: { id: lastExistingId }, skip: 1 } : {}),
				});
				if (existing.length === 0) break;
				staleIds.push(
					...existing
						.filter((entry: AppSourceAppSlugRow) => !remoteSlugs.has(entry.slug))
						.map((entry: AppSourceAppSlugRow) => entry.id),
				);
				lastExistingId = existing[existing.length - 1]!.id;
				if (existing.length < SOURCE_APP_CLEANUP_PAGE_SIZE) break;
			}
			for (let i = 0; i < staleIds.length; i += SOURCE_APP_CLEANUP_PAGE_SIZE) {
				const result = await prisma.appSourceApp.deleteMany({
					where: { id: { in: staleIds.slice(i, i + SOURCE_APP_CLEANUP_PAGE_SIZE) } },
				});
				removed += result.count;
			}
		} else {
			logger.warn(`Skipped stale app cleanup for ${source.name}: incomplete catalog or failed entries`);
		}

		// Update source metadata
		await prisma.appSource.update({
			where: { id: source.id },
			data: {
				lastSyncAt: new Date(),
				lastSyncStatus: errors === 0 ? "success" : synced ? "partial" : "error",
				lastSyncError: errors ? `${errors} of ${apps.length + rejected} catalog entries failed` : null,
				syncCount: { increment: 1 },
			},
		});

		logger.info(`Synced ${source.name}: ${synced} apps, ${errors} errors, ${removed} removed`);
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
	const results: Array<{ name: string; synced: number; errors: number }> = [];
	let after = "";
	while (true) {
		const sources = await prisma.appSource.findMany({
			where: { enabled: true, ...(after && { id: { gt: after } }) }, orderBy: { id: "asc" }, take: SOURCE_PAGE_SIZE,
		});
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
		if (sources.length < SOURCE_PAGE_SIZE) break;
		after = sources[sources.length - 1]!.id;
	}

	return results;
}

/**
 * Get all remote apps from the database, grouped by category.
 */
/**
 * Stars and monthly pulls of a catalogue app, from what was stored of its source row. An adapter knows them, but
 * the table has no column for them and they were dropped on the way in: the card's "⭐" and "monthly pulls" and
 * the ordering by popularity never had anything to show. Absent for rows synced before they were kept, and for a
 * custom feed's row that was cut off at the storage limit.
 */
function storedPopularity(rawJson: string | null | undefined): Pick<NormalizedApp, "stars" | "monthlyPulls"> {
	if (!rawJson) return {};
	let stored: unknown;
	try {
		stored = JSON.parse(rawJson);
	} catch {
		return {};
	}
	if (!stored || typeof stored !== "object") return {};
	const row = stored as Record<string, unknown>;
	const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);
	return { stars: count(row.stars), monthlyPulls: count(row.monthly_pulls ?? row.monthlyPulls) };
}

export async function getRemoteApps(
	slug?: string,
	options?: { searchQuery?: string; limit?: number },
): Promise<NormalizedApp[]> {
	if (options?.searchQuery) {
		const escaped = options.searchQuery.replace(/[\\%_]/g, "\\$&");
		const contains = { contains: escaped, mode: "insensitive" as const };
		const matched = await prisma.appSourceApp.findMany({
			where: {
				source: { enabled: true },
				slug: { notIn: [...builtinSlugs] },
				OR: [
					{ name: contains },
					{ slug: contains },
					{ description: contains },
					{ source: { name: contains } },
				],
			},
			orderBy: [{ category: "asc" }, { name: "asc" }, { id: "asc" }],
			take: options.limit ?? 20,
			select: {
				slug: true,
				name: true,
				category: true,
				icon: true,
				description: true,
				image: true,
				defaultPort: true,
				internalPort: true,
				path: true,
				command: true,
				sourceVersion: true,
				source: { select: { name: true } },
			},
		});
		return matched.map((app) => ({
			slug: app.slug,
			name: app.name,
			category: app.category,
			icon: app.icon,
			description: app.description,
			image: app.image,
			defaultPort: app.defaultPort,
			internalPort: app.internalPort ?? undefined,
			path: app.path,
			envJson: {},
			volumesJson: [],
			command: app.command ?? undefined,
			extraPorts: [],
			sourceVersion: app.sourceVersion ?? undefined,
			sourceName: app.source.name,
		}));
	}
	const apps: RemoteAppRow[] = [];
	let cursor: string | undefined;
	while (apps.length < MAX_REMOTE_APPS) {
		const page = await prisma.appSourceApp.findMany({
			where: { source: { enabled: true }, slug: slug ?? { notIn: [...builtinSlugs] } },
			orderBy: [{ category: "asc" }, { name: "asc" }, { id: "asc" }],
			take: slug ? 1 : Math.min(500, MAX_REMOTE_APPS - apps.length),
			...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
			include: { source: { select: { name: true } } },
		});
		apps.push(...page);
		if (page.length < 500) break;
		cursor = page[page.length - 1]!.id;
	}

	return apps.flatMap((app: RemoteAppRow): NormalizedApp[] => {
		try {
			return [
				{
					slug: app.slug,
					name: app.name,
					category: app.category,
					icon: app.icon,
					description: app.description,
					image: app.image,
					defaultPort: app.defaultPort,
					internalPort: app.internalPort ?? undefined,
					path: app.path,
					envJson: JSON.parse(app.envJson) as NormalizedApp["envJson"],
					volumesJson: JSON.parse(app.volumesJson) as NormalizedApp["volumesJson"],
					command: app.command ?? undefined,
					extraPorts: JSON.parse(app.extraPortsJson || "[]") as NormalizedApp["extraPorts"],
					sourceVersion: app.sourceVersion ?? undefined,
					sourceName: app.source.name,
					...storedPopularity(app.rawJson),
				},
			];
		} catch {
			// Corrupt JSON on one catalog row must not 500 the whole Quick Services list.
			return [];
		}
	});
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
