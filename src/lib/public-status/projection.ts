/**
 * Public status board projection: the only code that turns server records
 * into data for anonymous visitors.
 *
 * - One SQL statement loads every visible node with its latest numbers and
 *   heartbeat (no per-node queries, no SSH, no probes).
 * - `toPublicNode` copies whitelisted fields one by one and drops metric
 *   categories the site does not publish. Host, address, port, user name,
 *   credentials, tokens, raw Agent output, OS dialect, internal notes, error
 *   text, customer and server ids never enter the result.
 * - The list is cached in-process for CACHE_TTL_MS as finished DTOs; saving
 *   site or node settings clears it. Detail and history reads re-check
 *   visibility with their own indexed query on every request.
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getPublicStatusSummary } from "@/lib/status/service";
import { classifyPublicNode, type PublicNodeStatus } from "./status";
import { loadPublicSite } from "./site";
import type { PublicMetricCategory, PublicSiteConfig } from "./site-config";
import { VISIBLE_NODE_SQL } from "./visibility";
import type {
	PublicBoardQuery,
	PublicBoardResponse,
	PublicBoardSummary,
	PublicCountBucket,
	PublicNode,
	PublicNodeMetrics,
	PublicSiteInfo,
} from "./types";

export const CACHE_TTL_MS = 5_000;
/** Board load limit; beyond it the summary says `truncated` instead of hiding it. */
export const MAX_BOARD_NODES = 5_000;

export type VisibleNodeRow = {
	serverId: string;
	publicId: string;
	displayName: string;
	groupName: string | null;
	region: string | null;
	tags: string[] | null;
	sortOrder: number;
	note: string | null;
	maintenance: boolean;
	managementMode: "DIRECT" | "AGENT";
	agentLastSeenAt: Date | null;
	checkedAt: Date | null;
	online: boolean | null;
	offlineReason: string | null;
	metricsAt: Date | null;
	intervalSeconds: number | null;
	cpuUsage: number | null;
	cpuCores: number | null;
	load1: number | null;
	load5: number | null;
	load15: number | null;
	memUsage: number | null;
	memUsedMb: number | null;
	memTotalMb: number | null;
	swapUsage: number | null;
	diskUsage: number | null;
	diskUsedBytes: number | null;
	diskTotalBytes: number | null;
	uptimeSeconds: number | null;
	rxRateBps: number | null;
	txRateBps: number | null;
	rateIntervalSeconds: number | null;
	periodStart: Date | null;
	periodSince: Date | null;
	periodRxBytes: bigint | number | null;
	periodTxBytes: bigint | number | null;
	probeAt: Date | null;
	probeOk: boolean | null;
	probeLatencyMs: number | null;
};

const ROW_COLUMNS = Prisma.sql`
	n."serverId", n."publicId", n."displayName", n."groupName", n."region", n."tags", n."sortOrder", n."note", n."maintenance",
	s."managementMode"::text AS "managementMode", s."agentLastSeenAt",
	m."checkedAt", m."online", m."offlineReason", m."metricsAt", m."intervalSeconds",
	m."cpuUsage", m."cpuCores", m."load1", m."load5", m."load15",
	m."memUsage", m."memUsedMb", m."memTotalMb", m."swapUsage",
	m."diskUsage", m."diskUsedBytes", m."diskTotalBytes", m."uptimeSeconds",
	m."rxRateBps", m."txRateBps", m."rateIntervalSeconds",
	m."periodStart", m."periodSince", m."periodRxBytes", m."periodTxBytes",
	m."probeAt", m."probeOk", m."probeLatencyMs"`;

const ROW_FROM = Prisma.sql`
	FROM "public_status_nodes" n
	JOIN "servers" s ON s."id" = n."serverId"
	LEFT JOIN "teams" tm ON tm."id" = s."teamId"
	LEFT JOIN "server_metric_latest" m ON m."serverId" = n."serverId"`;

export async function loadVisibleNodeRows(limit = MAX_BOARD_NODES + 1): Promise<VisibleNodeRow[]> {
	return prisma.$queryRaw<VisibleNodeRow[]>`
		SELECT ${ROW_COLUMNS} ${ROW_FROM}
		WHERE ${VISIBLE_NODE_SQL}
		ORDER BY n."sortOrder" ASC, n."displayName" ASC, n."publicId" ASC
		LIMIT ${limit}`;
}

/**
 * Public ids that are visible right now, in board order. Cheap (no metric
 * join); the board runs it on every request so a cached list can never show
 * a node that was unpublished, disabled, moved to another customer or whose
 * customer was deleted after the cache was filled.
 */
export async function loadVisiblePublicIds(limit = MAX_BOARD_NODES): Promise<Set<string>> {
	const rows = await prisma.$queryRaw<Array<{ publicId: string }>>`
		SELECT n."publicId" ${ROW_FROM}
		WHERE ${VISIBLE_NODE_SQL}
		ORDER BY n."sortOrder" ASC, n."displayName" ASC, n."publicId" ASC
		LIMIT ${limit}`;
	return new Set(rows.map((row) => row.publicId));
}

/** The visible node with this public id, or null (unpublished, hidden, unknown). */
export async function loadVisibleNodeRow(publicId: string): Promise<VisibleNodeRow | null> {
	const rows = await prisma.$queryRaw<VisibleNodeRow[]>`
		SELECT ${ROW_COLUMNS} ${ROW_FROM}
		WHERE n."publicId" = ${publicId} AND ${VISIBLE_NODE_SQL}
		LIMIT 1`;
	return rows[0] ?? null;
}

function iso(value: Date | null | undefined): string | null {
	return value ? value.toISOString() : null;
}

function num(value: bigint | number | null | undefined): number | null {
	if (value === null || value === undefined) return null;
	const n = typeof value === "bigint" ? Number(value) : value;
	return Number.isFinite(n) ? n : null;
}

function round(value: number | null, digits = 1): number | null {
	if (value === null) return null;
	const f = 10 ** digits;
	return Math.round(value * f) / f;
}

export function publicSiteInfo(site: PublicSiteConfig): PublicSiteInfo {
	return {
		title: site.title,
		description: site.description,
		announcement: site.announcement,
		defaultView: site.defaultView,
		refreshSeconds: site.refreshSeconds,
		accent: site.accent,
		metrics: [...site.metrics],
		showPlatformStatus: site.showPlatformStatus,
	};
}

export function toPublicNode(row: VisibleNodeRow, allowed: ReadonlySet<PublicMetricCategory>, now: Date): PublicNode {
	const latest = row.checkedAt
		? {
				checkedAt: row.checkedAt,
				online: row.online === true,
				offlineReason: row.offlineReason,
				metricsAt: row.metricsAt,
				intervalSeconds: row.intervalSeconds,
			}
		: null;
	const verdict = classifyPublicNode({
		maintenance: row.maintenance,
		managementMode: row.managementMode === "AGENT" ? "AGENT" : "DIRECT",
		agentLastSeenAt: row.agentLastSeenAt,
		latest,
		now,
	});
	const hasMetrics = row.metricsAt !== null;
	const metrics: PublicNodeMetrics = {};
	if (hasMetrics && allowed.has("cpu")) metrics.cpu = { usage: round(row.cpuUsage), cores: row.cpuCores };
	if (hasMetrics && allowed.has("load")) metrics.load = { load1: round(row.load1, 2), load5: round(row.load5, 2), load15: round(row.load15, 2) };
	if (hasMetrics && allowed.has("memory")) {
		metrics.memory = {
			usage: round(row.memUsage),
			usedBytes: row.memUsedMb === null ? null : row.memUsedMb * 1024 * 1024,
			totalBytes: row.memTotalMb === null ? null : row.memTotalMb * 1024 * 1024,
			swapUsage: round(row.swapUsage),
		};
	}
	if (hasMetrics && allowed.has("disk")) {
		metrics.disk = { usage: round(row.diskUsage), usedBytes: num(row.diskUsedBytes), totalBytes: num(row.diskTotalBytes) };
	}
	if (hasMetrics && allowed.has("network")) {
		// A rate older than its freshness window is not "current throughput".
		const current = !verdict.metricsStale && verdict.status !== "offline";
		metrics.network = {
			rxBytesPerSecond: current ? round(row.rxRateBps, 0) : null,
			txBytesPerSecond: current ? round(row.txRateBps, 0) : null,
			rateWindowSeconds: current ? round(row.rateIntervalSeconds, 0) : null,
		};
	}
	if (hasMetrics && allowed.has("traffic")) {
		metrics.traffic = {
			periodRxBytes: row.periodStart ? num(row.periodRxBytes) : null,
			periodTxBytes: row.periodStart ? num(row.periodTxBytes) : null,
			periodStart: iso(row.periodStart),
			countedSince: iso(row.periodSince),
		};
	}
	if (hasMetrics && allowed.has("uptime")) metrics.uptime = { seconds: row.uptimeSeconds };
	if (allowed.has("latency") && row.probeAt) {
		metrics.latency = { ms: row.probeOk ? round(row.probeLatencyMs, 1) : null, ok: row.probeOk, at: iso(row.probeAt) };
	}
	return {
		id: row.publicId,
		name: row.displayName,
		group: row.groupName,
		region: row.region,
		tags: [...(row.tags ?? [])],
		note: row.note,
		status: verdict.status,
		offlineReason: verdict.offlineReason,
		metricsStale: verdict.metricsStale,
		metricsAt: iso(row.metricsAt),
		checkedAt: iso(row.checkedAt),
		heartbeatAt: row.managementMode === "AGENT" ? iso(row.agentLastSeenAt) : null,
		reportIntervalSeconds: row.intervalSeconds,
		metrics,
	};
}

function bucketCounts(nodes: PublicNode[], key: (node: PublicNode) => string | null): PublicCountBucket[] {
	const map = new Map<string, PublicCountBucket>();
	for (const node of nodes) {
		const name = key(node);
		if (!name) continue;
		const bucket = map.get(name) ?? { name, total: 0, online: 0 };
		bucket.total += 1;
		if (node.status === "online") bucket.online += 1;
		map.set(name, bucket);
	}
	return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function summarizeNodes(nodes: PublicNode[], truncated: boolean): PublicBoardSummary {
	const counts: Record<PublicNodeStatus, number> = { online: 0, offline: 0, stale: 0, unknown: 0, maintenance: 0 };
	let rx = 0;
	let tx = 0;
	let rateNodes = 0;
	let periodRx: number | null = null;
	let periodTx: number | null = null;
	let last: string | null = null;
	for (const node of nodes) {
		counts[node.status] += 1;
		const net = node.metrics.network;
		if (net && net.rxBytesPerSecond !== null && net.txBytesPerSecond !== null) {
			rx += net.rxBytesPerSecond;
			tx += net.txBytesPerSecond;
			rateNodes += 1;
		}
		const traffic = node.metrics.traffic;
		if (traffic && traffic.periodRxBytes !== null) periodRx = (periodRx ?? 0) + traffic.periodRxBytes;
		if (traffic && traffic.periodTxBytes !== null) periodTx = (periodTx ?? 0) + traffic.periodTxBytes;
		if (node.metricsAt && (!last || node.metricsAt > last)) last = node.metricsAt;
	}
	return {
		total: nodes.length,
		...counts,
		groups: bucketCounts(nodes, (node) => node.group),
		regions: bucketCounts(nodes, (node) => node.region),
		rxBytesPerSecond: rateNodes > 0 ? rx : null,
		txBytesPerSecond: rateNodes > 0 ? tx : null,
		rateNodes,
		periodRxBytes: periodRx,
		periodTxBytes: periodTx,
		lastSampleAt: last,
		truncated,
	};
}

/* ── Filtering / sorting / paging (in memory, over the cached DTOs) ── */

const STATUS_ORDER: Record<PublicNodeStatus, number> = { online: 0, maintenance: 1, stale: 2, unknown: 3, offline: 4 };

function sortValue(node: PublicNode, sort: PublicBoardQuery["sort"]): number | null {
	switch (sort) {
		case "cpu":
			return node.metrics.cpu?.usage ?? null;
		case "memory":
			return node.metrics.memory?.usage ?? null;
		case "disk":
			return node.metrics.disk?.usage ?? null;
		case "network": {
			const net = node.metrics.network;
			if (!net || net.rxBytesPerSecond === null || net.txBytesPerSecond === null) return null;
			return net.rxBytesPerSecond + net.txBytesPerSecond;
		}
		case "status":
			return STATUS_ORDER[node.status];
		default:
			return null;
	}
}

/** A sort on a metric the site does not publish falls back to the default order. */
export function effectiveSort(sort: PublicBoardQuery["sort"], allowed: ReadonlySet<PublicMetricCategory>): PublicBoardQuery["sort"] {
	if (sort === "cpu" && !allowed.has("cpu")) return "default";
	if (sort === "memory" && !allowed.has("memory")) return "default";
	if (sort === "disk" && !allowed.has("disk")) return "default";
	if (sort === "network" && !allowed.has("network")) return "default";
	return sort;
}

export function applyBoardQuery(nodes: PublicNode[], query: PublicBoardQuery, allowed: ReadonlySet<PublicMetricCategory>) {
	const needle = query.q.toLocaleLowerCase();
	let filtered = nodes.filter((node) => {
		if (query.status !== "all" && node.status !== query.status) return false;
		if (query.group && node.group !== query.group) return false;
		if (!needle) return true;
		return (
			node.name.toLocaleLowerCase().includes(needle) ||
			(node.region ?? "").toLocaleLowerCase().includes(needle) ||
			(node.group ?? "").toLocaleLowerCase().includes(needle) ||
			node.tags.some((tag) => tag.toLocaleLowerCase().includes(needle))
		);
	});
	const sort = effectiveSort(query.sort, allowed);
	if (sort !== "default") {
		const factor = query.dir === "desc" ? -1 : 1;
		const indexed = filtered.map((node, index) => ({ node, index }));
		indexed.sort((a, b) => {
			if (sort === "name") return factor * a.node.name.localeCompare(b.node.name) || a.index - b.index;
			const av = sortValue(a.node, sort);
			const bv = sortValue(b.node, sort);
			// Nodes without the value go last in either direction.
			if (av === null && bv === null) return a.index - b.index;
			if (av === null) return 1;
			if (bv === null) return -1;
			return factor * (av - bv) || a.index - b.index;
		});
		filtered = indexed.map((entry) => entry.node);
	} else if (query.dir === "desc") {
		filtered = [...filtered].reverse();
	}
	const filteredTotal = filtered.length;
	const totalPages = Math.max(1, Math.ceil(filteredTotal / query.pageSize));
	const page = Math.min(query.page, totalPages);
	const start = (page - 1) * query.pageSize;
	return {
		query: { ...query, sort, page },
		filteredTotal,
		totalPages,
		nodes: filtered.slice(start, start + query.pageSize),
	};
}

/* ── Cache ── */

export type BoardSnapshot = {
	site: PublicSiteConfig;
	nodes: PublicNode[];
	summary: PublicBoardSummary;
	platform: PublicBoardResponse["platform"];
	loadedAt: number;
};

let snapshot: BoardSnapshot | null = null;
let inflight: Promise<BoardSnapshot> | null = null;
let generation = 0;

/** Drop cached public data (call after any publication or site change). */
export function invalidatePublicStatusCache() {
	generation += 1;
	snapshot = null;
	inflight = null;
}

async function buildSnapshot(): Promise<BoardSnapshot> {
	const now = new Date();
	const [site, rows] = await Promise.all([loadPublicSite(), loadVisibleNodeRows()]);
	const truncated = rows.length > MAX_BOARD_NODES;
	const allowed = new Set(site.metrics);
	const nodes = rows.slice(0, MAX_BOARD_NODES).map((row) => toPublicNode(row, allowed, now));
	let platform: BoardSnapshot["platform"] = null;
	if (site.showPlatformStatus) {
		const status = await getPublicStatusSummary();
		platform = { overall: status.summary.overall };
	}
	return { site, nodes, summary: summarizeNodes(nodes, truncated), platform, loadedAt: Date.now() };
}

export async function getBoardSnapshot(): Promise<BoardSnapshot> {
	if (snapshot && Date.now() - snapshot.loadedAt < CACHE_TTL_MS) return snapshot;
	if (inflight) return inflight;
	const startedGeneration = generation;
	const pending = buildSnapshot()
		.then((value) => {
			if (startedGeneration === generation) snapshot = value;
			return value;
		})
		.finally(() => {
			if (inflight === pending) inflight = null;
		});
	inflight = pending;
	return pending;
}

/**
 * The cached board limited to the nodes visible now. Totals are recomputed
 * from the remaining DTOs, so a hidden node leaves the counts as well.
 */
export function restrictToVisible(board: BoardSnapshot, visible: ReadonlySet<string>): BoardSnapshot {
	if (board.nodes.every((node) => visible.has(node.id))) return board;
	const nodes = board.nodes.filter((node) => visible.has(node.id));
	return { ...board, nodes, summary: summarizeNodes(nodes, board.summary.truncated) };
}

/** True when a visible node is missing from the cached list (it must be rebuilt). */
export function snapshotMissesVisible(board: BoardSnapshot, visible: ReadonlySet<string>): boolean {
	if (visible.size === 0) return false;
	const cached = new Set(board.nodes.map((node) => node.id));
	for (const id of visible) if (!cached.has(id)) return true;
	return false;
}

export function buildBoardResponse(board: BoardSnapshot, query: PublicBoardQuery): PublicBoardResponse {
	const allowed = new Set(board.site.metrics);
	const page = applyBoardQuery(board.nodes, query, allowed);
	return {
		site: publicSiteInfo(board.site),
		platform: board.platform,
		summary: board.summary,
		query: page.query,
		filteredTotal: page.filteredTotal,
		totalPages: page.totalPages,
		nodes: page.nodes,
		generatedAt: new Date().toISOString(),
	};
}
