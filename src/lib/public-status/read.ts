/**
 * Read entry points of the status board, used by the public API routes and
 * the server-rendered pages. Every function returns `null` when the board is
 * closed (unless an administrator previews it) or the node is not visible —
 * callers answer 404 for both, so a guessed id learns nothing.
 *
 * Preview uses exactly the same projection as anonymous reads; it only
 * bypasses the "board closed" switch.
 */
import { prisma } from "@/lib/db";
import { appTimeZoneDateKey, shiftAppTimeZoneDay, startOfDayInAppTimeZone } from "@/lib/datetime/time-zone";
import {
	buildBoardResponse,
	getBoardSnapshot,
	invalidatePublicStatusCache,
	loadVisibleNodeRow,
	loadVisiblePublicIds,
	restrictToVisible,
	snapshotMissesVisible,
	publicSiteInfo,
	toPublicNode,
} from "./projection";
import {
	RANGE_SECONDS,
	availabilityFromCoverage,
	bucketSecondsFor,
	queryCoverage,
	queryNetworkBuckets,
	queryResourceBuckets,
	shapeNetworkPoints,
	shapeResourcePoints,
} from "./history";
import { loadPublicSite } from "./site";
import { LEGACY_SAMPLE_INTERVAL_SECONDS } from "./status";
import type {
	PublicBoardQuery,
	PublicBoardResponse,
	PublicHistoryRange,
	PublicHistoryResponse,
	PublicNodeDetailResponse,
	PublicUptimeDay,
} from "./types";
import { PUBLIC_ID_PATTERN } from "./query";

export type PublicReadOptions = { preview?: boolean };

export async function readPublicBoard(query: PublicBoardQuery, options: PublicReadOptions = {}): Promise<PublicBoardResponse | null> {
	// The site row and the set of visible public ids are read on every
	// request (two light queries). Only the metric DTOs come from the
	// few-second cache, so closing the board, unpublishing, disabling a
	// server, moving it to another customer or deleting the customer applies
	// at once, in every process.
	const [site, visible] = await Promise.all([loadPublicSite(), loadVisiblePublicIds()]);
	if (!site.enabled && !options.preview) return null;
	let board = await getBoardSnapshot();
	if (board.site.updatedAt !== site.updatedAt || snapshotMissesVisible(board, visible)) {
		invalidatePublicStatusCache();
		board = await getBoardSnapshot();
	}
	if (!board.site.enabled && !options.preview) return null;
	return buildBoardResponse(restrictToVisible(board, visible), query);
}

/** The last 90 application-time-zone days, one entry each, oldest first. */
async function uptimeDays(serverId: string, now: Date): Promise<PublicUptimeDay[]> {
	const since = startOfDayInAppTimeZone(shiftAppTimeZoneDay(now, -89));
	const rows = await prisma.serverUptimeSnapshot.findMany({
		where: { serverId, date: { gte: since } },
		orderBy: { date: "asc" },
		select: { date: true, uptimePercent: true, checkCount: true, onlineMinutes: true, offlineMinutes: true },
		take: 100,
	});
	const byDate = new Map(rows.map((row) => [appTimeZoneDateKey(row.date), row]));
	const todayStart = startOfDayInAppTimeZone(now);
	const days: PublicUptimeDay[] = [];
	for (let offset = 89; offset >= 0; offset--) {
		const date = appTimeZoneDateKey(shiftAppTimeZoneDay(now, -offset));
		const row = byDate.get(date);
		days.push({
			date,
			uptimePercent: row && row.checkCount > 0 ? row.uptimePercent : null,
			checkCount: row?.checkCount ?? 0,
			coveredMinutes: row ? Math.min(1440, row.onlineMinutes + row.offlineMinutes) : 0,
			expectedMinutes: offset === 0 ? Math.max(1, Math.floor((now.getTime() - todayStart.getTime()) / 60_000)) : 1440,
		});
	}
	return days;
}

export async function readPublicNode(publicId: string, options: PublicReadOptions = {}): Promise<PublicNodeDetailResponse | null> {
	if (!PUBLIC_ID_PATTERN.test(publicId)) return null;
	const site = await loadPublicSite();
	if (!site.enabled && !options.preview) return null;
	const row = await loadVisibleNodeRow(publicId);
	if (!row) return null;
	const now = new Date();
	const allowed = new Set(site.metrics);
	const node = toPublicNode(row, allowed, now);
	let availability: PublicNodeDetailResponse["availability"] = null;
	let days: PublicUptimeDay[] | null = null;
	if (allowed.has("availability")) {
		const [day, week, history] = await Promise.all([
			queryCoverage(row.serverId, new Date(now.getTime() - RANGE_SECONDS["24h"] * 1000), now),
			queryCoverage(row.serverId, new Date(now.getTime() - RANGE_SECONDS["7d"] * 1000), now),
			uptimeDays(row.serverId, now),
		]);
		availability = {
			last24h: availabilityFromCoverage(day, RANGE_SECONDS["24h"]),
			last7d: availabilityFromCoverage(week, RANGE_SECONDS["7d"]),
		};
		days = history;
	}
	return { site: publicSiteInfo(site), node, availability, uptimeDays: days, generatedAt: now.toISOString() };
}

/* History responses are cached briefly per server and range (after the visibility check). */
const HISTORY_TTL_MS = 30_000;
const HISTORY_CACHE_MAX = 500;
const historyCache = new Map<string, { at: number; value: Omit<PublicHistoryResponse, "generatedAt"> }>();

export function clearPublicHistoryCache() {
	historyCache.clear();
}

export async function readPublicHistory(publicId: string, range: PublicHistoryRange, options: PublicReadOptions = {}): Promise<PublicHistoryResponse | null> {
	if (!PUBLIC_ID_PATTERN.test(publicId)) return null;
	const site = await loadPublicSite();
	if (!site.enabled && !options.preview) return null;
	const row = await loadVisibleNodeRow(publicId);
	if (!row) return null;
	const allowed = new Set(site.metrics);
	const key = `${row.serverId}:${range}:${[...allowed].sort().join(",")}`;
	const cached = historyCache.get(key);
	if (cached && Date.now() - cached.at < HISTORY_TTL_MS) {
		return { ...cached.value, generatedAt: new Date().toISOString() };
	}

	const to = new Date();
	const from = new Date(to.getTime() - RANGE_SECONDS[range] * 1000);
	const bucketSeconds = bucketSecondsFor(range);
	const wantsResources = allowed.has("cpu") || allowed.has("memory") || allowed.has("disk") || allowed.has("load") || allowed.has("connections");
	const [resourceRows, networkRows, coverage] = await Promise.all([
		wantsResources || allowed.has("latency") ? queryResourceBuckets(row.serverId, from, to, bucketSeconds) : Promise.resolve([]),
		allowed.has("network") ? queryNetworkBuckets(row.serverId, from, to, bucketSeconds) : Promise.resolve([]),
		queryCoverage(row.serverId, from, to),
	]);
	const interval = coverage.interval ?? LEGACY_SAMPLE_INTERVAL_SECONDS;
	const shaped = shapeResourcePoints(resourceRows, bucketSeconds, interval);
	const resources = wantsResources
		? shaped.resources.map((point) => ({
				t: point.t,
				online: point.online,
				offline: point.offline,
				...(allowed.has("cpu") ? { cpu: point.cpu } : {}),
				...(allowed.has("memory") ? { memory: point.memory } : {}),
				...(allowed.has("disk") ? { disk: point.disk } : {}),
				...(allowed.has("load") ? { load: point.load } : {}),
				...(allowed.has("connections") ? { processes: point.processes, tcp: point.tcp, udp: point.udp } : {}),
			}))
		: null;
	const value: Omit<PublicHistoryResponse, "generatedAt"> = {
		range,
		from: from.toISOString(),
		to: to.toISOString(),
		bucketSeconds,
		sampleIntervalSeconds: coverage.samples > 0 ? interval : null,
		coveragePercent: Math.round(Math.min(1, coverage.covered / RANGE_SECONDS[range]) * 1000) / 10,
		samples: coverage.samples,
		resources,
		network: allowed.has("network") ? shapeNetworkPoints(networkRows, bucketSeconds, interval) : null,
		latency: allowed.has("latency")
			? { points: shaped.latency, probes: shaped.probes, failed: shaped.failed, measured: shaped.probes > 0 }
			: null,
	};
	if (historyCache.size >= HISTORY_CACHE_MAX) {
		const oldest = historyCache.keys().next().value;
		if (oldest !== undefined) historyCache.delete(oldest);
	}
	historyCache.set(key, { at: Date.now(), value });
	return { ...value, generatedAt: new Date().toISOString() };
}
